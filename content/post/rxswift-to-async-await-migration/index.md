+++
author = "오깅중"
title = "RxSwift 코드베이스에서 async/await로 점진 마이그레이션하는 방법"
slug = "rxswift-to-async-await-migration"
date = "2026-05-21T09:44:00+09:00"
description = "RxSwift 의존이 큰 iOS 프로젝트에서 신규 코드부터 Swift Concurrency로 옮기는 단계별 전략. Repository async 미러, UseCase 공존, 호출자 화면 단위 전환까지."
categories = ["Swift"]
tags = ["Swift", "RxSwift", "AsyncAwait", "Concurrency", "Migration", "iOS"]
+++

RxSwift가 오래 깔린 iOS 프로젝트를 Swift Concurrency로 옮기는 건 생각보다 무겁다.

`Observable` 몇 개를 `async`로 바꾸면 끝나는 문제가 아니었다. 보통은 Repository, UseCase, ViewModel, Coordinator까지 전 레이어에 Rx 타입이 퍼져 있다. 이런 상태에서 "이번 PR에서 RxSwift 제거합니다" 하면... 거의 반드시 터진다.

그래서 내가 선택한 방향은 완전 교체가 아니라 **신규 코드부터 async/await로 끊고, 기존 코드는 화면 단위로 천천히 옮기는 방식**이었다. 한 번에 다 바꾸는 건 좀 무서웠다.

## 먼저 규모부터 봤다

마이그레이션은 감으로 시작하면 금방 커진다. 먼저 RxSwift가 얼마나 박혀 있는지 숫자로 봤다.

```bash
rg -l "import RxSwift" AppSources -g "*.swift" | wc -l
```

Rx 타입 사용량도 같이 봤다.

```bash
rg "Observable<|Single<|Completable|DisposeBag" AppSources -g "*.swift" | wc -l
```

어느 레이어에 많은지도 봤다.

```bash
rg -l "import RxSwift" AppSources -g "*.swift" \
  | awk -F'/' '{print $2}' \
  | sort -u
```

Data, Domain, Presentation 전부에서 나오면 한 번에 갈아엎는 건 현실적으로 어렵다. 이 숫자가 크면 클수록 "점진 마이그레이션"이 아니라 그냥 "큰 리라이트"에 가까워진다. 그럼 PR도 리뷰도 같이 커진다.

## 기존 Rx API는 당장 안 깼다

처음 잡은 기준은 기존 호출자를 깨지 않는 쪽이었다. 일단 빌드가 계속 살아 있어야 했으니까.

Repository에서 바로 기존 `Observable` 메서드를 지우지 않고, async 미러 메서드를 옆에 추가했다.

```swift
// 기존 호출자용
public func loadItem(
    containerID: String,
    itemID: String
) -> Observable<ItemDetail?> {
    ...
}

// 신규 호출자용
public func loadItemAsync(
    containerID: String,
    itemID: String
) async throws -> ItemDetail? {
    let result = await ItemLoader()
        .loadItem(
            containerID: containerID,
            itemID: itemID
        )
        .execute()

    switch result {
    case let .success(item):
        return item
    case let .failure(error):
        throw error
    }
}
```

하부 코드가 이미 async를 지원한다면 거의 무료로 추가할 수 있다. 하부가 Rx뿐이라면 잠깐 adapter가 필요하지만, 가능하면 아래쪽부터 async를 열어두는 쪽이 덜 찝찝했다.

## UseCase는 한동안 두 얼굴이었다

UseCase도 바로 하나로 통일하지 않았다. 기존 호출자는 `callAsFunction`, 신규 호출자는 `execute`를 쓰게 했다. 잠깐 못생긴 상태를 허용한 셈이다.

```swift
public final class LoadItemUseCase {
    private let repository: ItemRepository

    // 기존 Rx 호출자용
    public func callAsFunction(
        containerID: String,
        itemID: String
    ) -> Observable<ItemDetail?> {
        repository.loadItem(
            containerID: containerID,
            itemID: itemID
        )
    }

    // 신규 async 호출자용
    public func execute(
        containerID: String,
        itemID: String
    ) async throws -> ItemDetail? {
        try await repository.loadItemAsync(
            containerID: containerID,
            itemID: itemID
        )
    }
}
```

이 시기가 조금 보기 싫긴 하다. 같은 UseCase에 Rx와 async가 공존하니까. 그래도 큰 프로젝트에서는 이 중간 상태가 필요했다.

대신 코멘트로 방향은 남겨뒀다.

```swift
/// 신규 호출자는 execute(...) async throws를 사용한다.
/// callAsFunction은 기존 Rx 호출자 호환용이며 호출자 제거 후 삭제한다.
```

이렇게 안 해두면 반년 뒤에 누군가 새 코드에서 다시 Rx 시그니처를 잡을 수 있다. 나도 까먹을 수 있고.

## 호출자는 화면 단위로 옮겼다

UseCase 하나의 호출자가 10개라면 10개를 한 PR에서 다 바꾸지 않았다. 화면 하나, 흐름 하나씩 옮겼다. 그래야 리뷰할 때도 정신이 덜 나간다.

기존 코드는 보통 이런 모양이었다.

```swift
useCases.loadItem(containerID: containerID, itemID: itemID)
    .subscribe(on: ConcurrentDispatchQueueScheduler(qos: .default))
    .observe(on: MainScheduler.instance)
    .subscribe(
        onNext: { [weak self] item in
            self?.show(item)
        },
        onError: { [weak self] error in
            self?.showError(error)
        },
        onDisposed: { [weak self] in
            self?.isLoading = false
        }
    )
    .disposed(by: disposeBag)
```

async/await로 옮기면 이런 식으로 바꿨다.

```swift
loadItemTask?.cancel()
loadItemTask = Task { [weak self] in
    defer {
        Task { @MainActor in
            self?.isLoading = false
        }
    }

    do {
        let item = try await self?.useCases.loadItem.execute(
            containerID: containerID,
            itemID: itemID
        )

        await MainActor.run {
            self?.show(item)
        }
    } catch is CancellationError {
        return
    } catch {
        await MainActor.run {
            self?.showError(error)
        }
    }
}
```

Rx에서 async로 바꿀 때 동치성은 대충 이렇게 맞춰봤다.

|RxSwift|async/await|
|---|---|
|`subscribe(on:)`|`Task {}` 또는 하위 async 구현의 실행 컨텍스트|
|`observe(on: MainScheduler.instance)`|`@MainActor` / `MainActor.run`|
|`onDisposed`|`defer`|
|`disposed(by:)`|`Task` handle 저장 후 cancel|
|`onError`|`catch`|

특히 `disposed(by:)`를 무시하면 화면이 사라진 뒤에도 Task가 살아 있을 수 있다. 예전엔 disposeBag이 해주던 일을 이제는 내가 Task handle로 챙겨야 하는 느낌이었다.

## 삭제 타이밍은 호출자 수를 보고 정했다

UseCase의 Rx 시그니처를 언제 지울지는 감으로 정하지 않았다. 호출자 수를 먼저 봤다.

```bash
rg "useCases\\.loadItem|loadItemUseCase" AppSources -g "*.swift"
```

호출자가 1-2개면 그 PR에서 async 전환 후 Rx 시그니처까지 바로 삭제했다. 호출자가 많으면 공존 상태로 두고 다음 PR로 넘겼다. 괜히 욕심내면 PR이 너무 커졌다.

이 기준이 없으면 "조금만 더 바꾸자" 하다가 PR이 너무 커진다. 그러면 리뷰가 힘들어지고, 충돌도 늘고, 롤백도 어려워진다.

## continuation adapter는 좀 조심해야 했다

하부가 Rx뿐인데 위쪽만 async로 열고 싶으면 `withCheckedThrowingContinuation`을 쓰게 된다.

```swift
func loadItemAsync(...) async throws -> ItemDetail? {
    try await withCheckedThrowingContinuation { continuation in
        repository.loadItem(...)
            .take(1)
            .subscribe(
                onNext: { continuation.resume(returning: $0) },
                onError: { continuation.resume(throwing: $0) }
            )
            .disposed(by: disposeBag)
    }
}
```

여기에는 함정이 있었다.

함수 지역 `DisposeBag`을 만들면 함수가 끝나기도 전에 subscription이 해제될 수 있다. 반대로 인스턴스 `DisposeBag`에 계속 쌓으면 일회성 bridge가 누수처럼 남는다. 그리고 `onNext`가 여러 번 오는 Observable이면 continuation을 두 번 resume하는 사고도 난다. 이건 진짜 애매하다.

그래서 adapter를 쓸 때는 최소한 `take(1)`을 붙이고, 가능하면 아래쪽 Repository나 factory를 async로 직접 열었다. bridge는 오래 유지할수록 빚처럼 남았다.

## 스레드 가정도 다시 확인했다

Rx 코드에는 스케줄러 의도가 코드에 박혀 있다.

```swift
.subscribe(on: ConcurrentDispatchQueueScheduler(qos: .default))
.observe(on: MainScheduler.instance)
```

async/await로 바꾸면 이 의도가 흐릿해질 수 있다. 특히 호출자가 `@MainActor`인데 UseCase 내부가 동기 작업을 오래 한다면 메인을 잡을 수 있다.

이럴 땐 그냥 찍어봤다.

```swift
print("before:", Thread.isMainThread)
let result = try await useCase.execute(...)
print("after:", Thread.isMainThread)
```

그리고 UI 반영은 명시적으로 `MainActor`에 넣었다. "아마 메인일 것"보다 "여기는 메인이다"가 나중에 덜 헷갈렸다.

## 정리

RxSwift에서 async/await로 옮기는 작업은 기술보다 순서가 더 중요하게 느껴졌다.

- 먼저 RxSwift 의존 규모를 숫자로 본다
- Repository에 async 미러 메서드를 옆에 둔다
- UseCase는 한동안 Rx와 async 시그니처를 같이 둔다
- 호출자는 화면 단위로 바꾼다
- 호출자가 사라진 UseCase부터 Rx 시그니처를 지운다
- continuation adapter는 짧게 쓰고 빨리 없앤다
- 스케줄러 의도가 깨지지 않았는지 한 번은 확인한다

한 번에 다 지우려고 하면 일이 커진다. 반대로 신규 코드부터 `async throws`로만 열어두면, 시간이 지나면서 RxSwift가 자연스럽게 가장자리로 밀려난다. 그 상태가 되면 제거도 훨씬 덜 무섭다.

관련 검색어: RxSwift async await migration, Swift Concurrency migration, Observable to async await, withCheckedThrowingContinuation RxSwift, iOS RxSwift 제거.
