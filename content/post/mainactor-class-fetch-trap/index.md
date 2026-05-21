+++
author = "오깅중"
title = "@MainActor를 클래스에 통째로 붙이면 생기는 fetch 함정"
slug = "mainactor-class-fetch-trap"
date = "2026-05-21T09:40:00+09:00"
description = "UIKit 때문에 클래스 전체에 @MainActor를 붙였다가 async fetch까지 메인 액터에 묶인 사례. Swift Concurrency에서 UI 빌드와 데이터 fetch 격리를 나누는 방법."
categories = ["Swift"]
tags = ["Swift", "Concurrency", "MainActor", "UIKit", "AsyncAwait", "Debugging"]
+++

Swift Concurrency로 코드를 옮기다 보면 `@MainActor`를 어디까지 붙여야 하는지 은근 애매하다.

이번에 만난 케이스도 딱 그랬다. 외부 이벤트를 받으면 서버에서 상세 데이터를 단건 fetch하고, 그 결과로 상세 화면 Coordinator를 만든 다음 navigation stack에 push하는 코드였다. Coordinator 빌드는 UIKit을 만지니까 메인 스레드가 맞고... 그래서 처음엔 클래스 전체에 `@MainActor`를 붙였다.

빌드는 됐다. 동작도 했다. 그런데 동료가 한마디 했다.

> 그러면 fetch도 메인에서 도는 거 아니에요?

맞다. 여기서 살짝 머리 맞은 느낌이었다.

## 처음 코드는 이런 모양이었다

대략 이런 store가 있었다.

```swift
@MainActor
final class DetailRouteResolver {
    private let useCases: DetailUseCases

    func resolveDetail(for route: AppRoute) async -> ResolvedDetail? {
        let item = try? await useCases.loadDetail.execute(
            containerID: route.containerID,
            itemID: route.itemID
        )

        // item으로 DetailCoordinator 빌드
        // UIKit / UINavigationController / UIViewController 접근
        return ResolvedDetail(...)
    }
}
```

그때 생각은 단순했다.

- 상세 화면을 만들 때 UIKit을 만진다
- UIKit은 메인 스레드에서 만져야 한다
- 그러면 `DetailRouteResolver`를 `@MainActor`로 격리하면 되겠네?

처음 보면 그럴듯하다. 근데 다시 보면... 이 클래스 안에 **UI 빌드만 있는 게 아니라 서버 fetch도 같이 있는** 상태였다.

## @MainActor class는 생각보다 넓게 묶인다

`@MainActor`를 클래스에 붙이면 그 클래스의 인스턴스 메서드는 기본적으로 메인 액터에 묶인다.

```swift
Task { @MainActor in
    await detailStore.resolveDetail(for: route)
}
```

이렇게 호출하면 `resolveDetail` 본문은 메인 액터에서 돈다. 여기까지는 예상한 대로였다. 그런데 내가 놓친 부분은, 본문 안의 `await`가 자동으로 백그라운드 실행을 보장해주는 건 아니라는 거였다.

```swift
let item = try? await useCases.loadDetail.execute(...)
```

`await`는 "여기서 suspend될 수 있다"는 지점이지, "무조건 다른 스레드로 보내준다"는 뜻은 아니었다. 호출하는 함수가 같은 actor에 격리되어 있거나, 내부에서 동기 작업을 오래 잡고 있거나, RxSwift의 cold observable을 얇게 `await`로 감싼 구조라면 생각보다 쉽게 메인 스레드를 잡고 있을 수 있다.

즉, 클래스 전체에 `@MainActor`를 붙인 순간 대충 이런 그림이 된다.

- UIKit 빌드 코드: 메인에서 실행됨. 여기까진 의도한 동작
- 데이터 fetch 진입 코드: 이것도 메인 액터에서 시작됨
- fetch 내부가 완전히 비동기로 잘 빠지지 않으면... 메인 스레드가 막힐 수 있음

UI 때문에 붙인 어노테이션이 네트워크/DB 경로까지 같이 끌고 간 셈이었다.

## fetch랑 UI 빌드는 따로 봐야 했다

그래서 고친 방향은 단순했다. 클래스 전체 격리를 빼고, UI를 실제로 만드는 부분만 `@MainActor`로 좁혔다.

```swift
final class DetailRouteResolver {
    private let useCases: DetailUseCases

    func resolveDetail(for route: AppRoute) async -> ResolvedDetail? {
        guard let item = try? await useCases.loadDetail.execute(
            containerID: route.containerID,
            itemID: route.itemID
        ) else {
            return nil
        }

        return await makeDetail(from: item, route: route)
    }

    @MainActor
    private func makeDetail(
        from item: DetailItem,
        route: AppRoute
    ) -> ResolvedDetail {
        let coordinator = DetailCoordinator(...)
        coordinator.build(...)

        return ResolvedDetail(coordinator: coordinator)
    }
}
```

다시 말하면 이런 느낌으로 나눴다.

- `DetailRouteResolver` 자체는 non-isolated로 둔다
- 데이터 fetch는 `resolveDetail`에서 처리한다
- UIKit을 만지는 `makeDetail`만 `@MainActor`로 묶는다

이렇게 하니까 fetch와 UI 빌드의 경계가 훨씬 선명해졌다. fetch는 fetch대로 흘러가고, 화면 생성이 필요한 순간에만 메인 액터로 돌아온다.

## MainActor.run으로만 잘라도 됨

메서드를 나누기 애매하면 `MainActor.run` 블록으로만 잘라도 괜찮다.

```swift
func resolveDetail(for route: AppRoute) async -> ResolvedDetail? {
    guard let item = try? await useCases.loadDetail.execute(
        containerID: route.containerID,
        itemID: route.itemID
    ) else {
        return nil
    }

    return await MainActor.run {
        let coordinator = DetailCoordinator(...)
        coordinator.build(...)
        return ResolvedDetail(coordinator: coordinator)
    }
}
```

개인적으로는 `@MainActor private func makeDetail(...)` 쪽이 더 읽기 좋았다. "아, 여기부터 UI 영역이구나"가 함수 시그니처에 남아서 나중에 다시 봐도 덜 헷갈렸다.

## actor로 만들면 더 낫나? 싶었는데

처음엔 `actor DetailRouteResolver`도 생각했다. 그런데 이 케이스에서는 오히려 애매했다.

`actor`로 만들면 store의 상태 보호는 쉬워진다. 근데 UIKit을 만드는 순간 어차피 `MainActor`로 다시 전환해야 했다.

```swift
actor DetailRouteResolver {
    func resolveDetail(for route: AppRoute) async -> ResolvedDetail? {
        let item = try? await useCases.loadDetail.execute(...)

        return await MainActor.run {
            // UIKit 빌드
        }
    }
}
```

상태를 강하게 보호해야 하는 store라면 actor가 맞을 수도 있다. 다만 이 케이스는 상태 관리보다 "fetch 후 UI 빌드"가 핵심이었다. 괜히 actor를 만들면 actor 격리와 MainActor 격리가 섞여서 읽기만 더 어려워졌다.

이 정도의 작은 라우팅용 객체라면 **클래스는 non-isolated, UI 메서드만 MainActor**가 제일 덜 복잡했다.

## 진짜 어디서 도는지는 찍어봤다

이런 건 말로만 생각하면 또 헷갈린다. 의심되면 그냥 바로 찍어보는 게 빨랐다.

```swift
func resolveDetail(for route: AppRoute) async -> ResolvedDetail? {
    print("before fetch:", Thread.isMainThread)

    let item = try? await useCases.loadDetail.execute(...)

    print("after fetch:", Thread.isMainThread)

    return await makeDetail(from: item, route: route)
}

@MainActor
private func makeDetail(from item: DetailItem, route: AppRoute) -> ResolvedDetail {
    print("make detail:", Thread.isMainThread)
    ...
}
```

`make detail`은 `true`가 맞다. 그런데 fetch 전후가 계속 `true`로 찍히고, 그 안에서 동기 작업이 무겁다면... 그때는 구조를 다시 봐야 했다. Instruments의 Time Profiler에서 main thread가 fetch 쪽 call stack에 오래 잡혀 있는지도 같이 보면 더 확실했다.

## 정리

UIKit이 섞였다고 클래스 전체에 `@MainActor`를 붙이면 일단 편해 보인다. 그런데 그 클래스 안에 fetch, 파싱, DB 접근까지 같이 있으면 격리 범위가 생각보다 훅 넓어진다.

이번 케이스는 나는 이렇게 정리했다.

- `@MainActor`는 UI를 실제로 만지는 경계에만 붙이는 게 낫다
- `await`는 백그라운드 실행 보장 키워드가 아니었다
- 데이터 fetch와 UI 빌드는 같은 함수에 있어도 따로 봐야 했다
- 클래스 전체 격리보다 메서드 단위 격리가 디버깅하기 쉬웠다

Swift Concurrency에서 중요한 건 "async니까 괜찮겠지"가 아니라, <strong>지금 이 코드가 어느 actor에 묶여 있지?</strong>를 계속 좁게 보는 쪽에 가까웠다.

관련 검색어: Swift @MainActor class, Swift Concurrency MainActor, async await main thread, UIKit MainActor, Swift actor isolation.
