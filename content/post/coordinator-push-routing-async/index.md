+++
author = "오깅중"
title = "iOS Coordinator에서 푸시 진입을 단일 라우터로 정리한 기록"
slug = "coordinator-push-routing-async"
date = "2026-05-21T09:42:00+09:00"
description = "UIKit MVVM Coordinator 앱에서 list ViewModel이 푸시를 직접 구독하던 구조를 AppNavigationRouter와 async/await 기반 단일 진입점으로 정리한 사례."
categories = ["Swift"]
tags = ["iOS", "Swift", "Coordinator", "PushNotification", "AsyncAwait", "UIKit"]
+++

UIKit + MVVM + Coordinator 구조에서 푸시 알림을 처리하다 보면 어느 순간 코드가 이상한 방향으로 자란다.

처음엔 되게 단순하다. A 리스트는 A 타입 이벤트를 구독하고, B 리스트는 B 타입 이벤트를 구독한다. 각 화면이 자기 관심사를 처리하니까 자연스러워 보인다.

근데 실제 앱에서는 금방 꼬인다.

- 앱이 cold launch일 때 list가 아직 없다
- 탭 전환이 끝나기 전에 detail push가 들어온다
- 같은 payload가 pending route와 notification tap 경로로 두 번 들어온다
- list ViewModel이 화면 표시와 푸시 정책을 같이 들고 있다

결론부터 말하면, 내 경우엔 푸시 진입을 list가 아니라 **단일 라우터** 쪽으로 빼는 게 훨씬 나았다.

## 원래 구조: 화면마다 푸시를 직접 구독

초기 구조는 이런 식이었다.

```swift
final class ItemListViewModel {
    init(...) {
        AppRouteManager.shared.eventSubject
            .filter { $0.page == .items }
            .sink { [weak self] event in
                self?.handleItemEvent(event)
            }
            .store(in: &cancellables)
    }
}

final class ContentListViewModel {
    init(...) {
        AppRouteManager.shared.eventSubject
            .filter { $0.page == .content }
            .sink { [weak self] event in
                self?.handleContentEvent(event)
            }
            .store(in: &cancellables)
    }
}
```

처음엔 나쁘지 않아 보인다. 근데 계속 겪어보니 푸시는 화면 이벤트라기보다, 앱 바깥에서 들어오는 라우팅 이벤트에 더 가까웠다.

list가 살아 있을 때만 처리되는 구조라면 cold-launch 푸시는 바로 race가 된다. 로그인 직후 탭바가 아직 안 떴거나, 사용자가 다른 탭에 있거나, list coordinator가 re-attach 되는 중이면 이벤트가 증발하거나 중복 처리된다. 여기서부터 뭔가 찜찜해진다.

그리고 더 큰 문제는 정책 변경이었다. 예를 들어 "푸시 진입 시 기존 modal을 닫고 대상 탭으로 이동한 뒤 상세 화면을 push한다"는 정책이 생기면 화면마다 같은 로직을 복붙하게 된다. 이쯤 되면 화면 코드가 라우터 역할까지 하기 시작한다.

## 단일 진입점: AppNavigationRouter

그래서 푸시 payload를 바로 화면에 던지지 않고, 먼저 route envelope으로 한 번 감쌌다.

```swift
struct RouteEnvelope {
    let id: UUID
    let route: AppRoute
    let receivedAt: Date
}
```

`AppRouteManager`는 raw payload를 `RouteEnvelope`로 만들고, 실제 화면 이동은 `AppNavigationRouter`가 맡게 했다.

```swift
final class AppNavigationRouter {
    private let routeManager: AppRouteManager
    private weak var host: RouteHandlingHost?
    private let enabledPages: Set<AppPage>
    private let detailFactory: RouteDetailFactory

    init(
        routeManager: AppRouteManager,
        host: RouteHandlingHost,
        enabledPages: Set<AppPage>,
        detailFactory: RouteDetailFactory
    ) {
        self.routeManager = routeManager
        self.host = host
        self.enabledPages = enabledPages
        self.detailFactory = detailFactory
    }

    private func consume(envelope: RouteEnvelope) {
        guard routeManager.isRouteConsumed(envelope.id) == false else { return }

        // route 검증, 탭 선택, list attach, detail push
    }
}
```

라우터를 만들고 나니 책임이 이렇게 갈렸다.

- `AppRouteManager`: payload 정규화, fingerprint dedupe, envelope 발행
- `AppNavigationRouter`: route 소비, ready gate, async 처리 흐름 제어
- host coordinator: 실제 탭 전환과 navigation stack 조작
- `RouteDetailFactory`: route를 상세 화면에 필요한 ViewController/Coordinator로 변환

역할이 갈라지니까 디버깅할 때 보는 지점도 훨씬 선명해졌다.

## list와 detail 결정을 분리했다

여기서 제일 크게 바꾼 건 list ViewModel이 detail을 만들지 않게 한 부분이었다.

기존에는 특정 list가 살아 있어야 해당 detail을 push할 수 있었다. 그런데 푸시 진입은 list가 아직 없을 때도 들어온다. 다시 말해 detail을 결정하는 코드는 list lifecycle 밖에 있어야 했다.

```swift
final class RouteDetailFactory {
    func resolveDetail(
        for route: AppRoute,
        navigationController: UINavigationController
    ) async -> ResolvedDetail? {
        switch route {
        case let .itemDetail(containerID, itemID):
            return await resolveItemDetail(
                containerID: containerID,
                itemID: itemID,
                navigationController: navigationController
            )

        case let .contentDetail(sectionID, contentID):
            return await resolveContentDetail(
                sectionID: sectionID,
                contentID: contentID,
                navigationController: navigationController
            )
        }
    }
}
```

`RouteDetailFactory`는 route만 알면 상세 화면을 만들 수 있다. 필요한 단건 fetch도 여기서 `await`로 끝낸다. list가 떠 있는지, 방금 attach됐는지, 기존 list인지 새 list인지... 이런 건 여기서 신경 쓰지 않게 했다.

이렇게 나누니까 "list가 없어서 푸시를 못 받는" 구조 자체가 사라졌다.

## host 계약은 세 단계로 나눴다

라우터가 모든 UIKit 조작을 직접 하면 결국 또 거대한 god object가 된다. 그래서 실제 화면 제어는 host coordinator에 넘겼다.

```swift
protocol RouteHandlingHost: AnyObject {
    var isPushNavigationReady: Bool { get }

    func registerPushReadyCallback(_ callback: @escaping () -> Void)

    func selectTab(
        for page: AppPage,
        completion: @escaping () -> Void
    )

    func ensureServiceListAttached(
        for route: AppRoute
    ) -> UINavigationController?

    func pushDetail(
        _ detail: ResolvedDetail,
        navigationController: UINavigationController,
        page: AppPage
    )
}
```

이건 일부러 한 함수로 합치지 않았다. 세 단계가 비슷해 보여도 실제로 하는 일이 꽤 달랐다.

1. `selectTab`: modal 정리, 대상 탭 전환
2. `ensureServiceListAttached`: 뒤로가기용 list coordinator 붙이기
3. `pushDetail`: factory가 만든 상세 화면 push

라우터의 흐름은 이렇게 읽힌다.

```swift
host.selectTab(for: page) { [weak self] in
    guard let self else { return }

    Task { @MainActor in
        guard let nav = self.host?.ensureServiceListAttached(for: route) else {
            self.routeManager.markRouteConsumed(envelope.id)
            return
        }

        guard let detail = await self.detailFactory.resolveDetail(
            for: route,
            navigationController: nav
        ) else {
            self.routeManager.markRouteConsumed(envelope.id)
            return
        }

        self.host?.pushDetail(detail, navigationController: nav, page: page)
        self.routeManager.markRouteConsumed(envelope.id)
    }
}
```

이 흐름이 마음에 들었던 건 비동기 경계가 눈에 보인다는 점이었다. 탭 전환이 끝난 뒤 list를 붙이고, 그 다음 필요한 데이터를 fetch하고, 마지막에 UI push를 한다. 읽을 때 순서가 보인다.

## cold-launch에는 ready gate가 필요했다

앱이 푸시로 켜졌는데 아직 로그인/탭바 구성이 끝나지 않은 경우도 있다. 이때 라우터가 바로 push를 시도하면 실패한다. 당연히 host가 아직 없으니까...

그래서 host에 ready gate를 뒀다.

```swift
if host.isPushNavigationReady {
    execute()
} else {
    host.registerPushReadyCallback(execute)
}
```

여기서 `registerPushReadyCallback`은 단일 슬롯으로 두면 불안했다. 같은 시점에 여러 route가 대기할 수 있고, ready 직전에 callback이 하나 더 등록될 수도 있다. 그래서 배열로 보관하고 ready가 되는 순간 순서대로 fire하는 쪽으로 봤다.

## early return에서도 소비 처리를 빼먹으면 안 됐다

이 구조에서 제일 자주 실수한 건 `markRouteConsumed` 누락이었다.

```swift
guard let nav = host.ensureServiceListAttached(for: route) else {
    pushManager.markRouteConsumed(envelope.id)
    return
}
```

실패했는데 왜 consumed 처리하냐고 볼 수도 있다. 근데 이 envelope은 이미 라우터가 한 번 판단한 이벤트다. host가 없거나 list attach가 불가능한 상황에서 계속 pending에 남겨두면, 다음 host attach 때 같은 envelope이 무한 재처리될 수 있었다.

재시도 정책이 정말 필요하면 별도의 retry queue를 두는 게 맞아 보였다. 소비 여부와 재시도 정책을 한 Set에 섞으면 디버깅이 너무 어려워진다.

## 정리

푸시 진입은 화면 내부 이벤트처럼 다루면 계속 꼬였다. 특히 Coordinator 구조에서는 list, detail, tab, modal이 각자 lifecycle을 갖기 때문에 외부 이벤트를 화면마다 구독하게 두면 race가 생기기 쉽다.

그래서 이번 정리는 대충 이렇게 가져갔다.

- 푸시는 list ViewModel이 아니라 `AppNavigationRouter`가 받는다
- raw payload는 `RouteEnvelope`으로 한 번 감싼다
- list attach와 detail 결정은 `RouteDetailFactory`로 분리한다
- host 계약은 `selectTab -> ensureServiceListAttached -> pushDetail` 순서로 나눈다
- cold-launch는 ready callback으로 잠깐 기다린다
- early return에서도 envelope 소비를 빼먹지 않는다

이렇게 바꾸고 나니 푸시 라우팅 버그를 볼 때 "어느 화면이 구독하고 있지?"가 아니라 "route가 어느 단계에서 멈췄지?"를 보면 됐다. 이 차이가 생각보다 컸다.

관련 검색어: iOS push notification routing, Swift Coordinator pattern, async await Coordinator, MVVM Coordinator push notification, iOS cold launch push.
