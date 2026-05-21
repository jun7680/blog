+++
author = "오깅중"
title = "iOS 푸시 알림 중복 진입을 막는 2층 dedupe 패턴"
slug = "ios-push-dedupe-two-layer"
date = "2026-05-21T09:46:00+09:00"
description = "같은 iOS 푸시가 notification tap, cold launch, pending route 경로로 중복 처리되는 문제를 fingerprint dedupe와 envelope id 소비 추적으로 막은 사례."
categories = ["Swift"]
tags = ["iOS", "PushNotification", "Swift", "Coordinator", "Deduplication", "Debugging"]
+++

iOS 푸시 알림은 생각보다 같은 이벤트가 두 번 들어오기 쉽다.

사용자는 알림을 한 번 눌렀는데 앱 안에서는 notification tap, cold launch payload, pending route, ready callback 같은 경로가 겹친다. 결과는 익숙하다. 같은 상세 화면이 navigation stack에 두 번 쌓인다. 또는 이미 처리한 푸시가 host attach 시점에 다시 살아난다. 보고 있으면 좀 허탈하다.

처음엔 `Set<UUID>` 하나면 될 줄 알았다. 아니었다. 중복의 종류가 달라서 dedupe도 두 층으로 봐야 했다.

내가 정리한 형태는 **내용 기반 fingerprint dedupe + envelope id 소비 추적**이었다. 이름은 거창한데, 결국 "내용 중복"과 "처리 중복"을 따로 본다는 얘기다.

## envelope id만으로는 부족했다

가장 먼저 떠올린 방식은 envelope id를 소비 처리하는 쪽이었다. 나도 처음엔 이거면 끝일 줄 알았다.

```swift
private var consumedRouteIds = Set<UUID>()

func handleRoute(envelope: RouteEnvelope) {
    guard consumedRouteIds.contains(envelope.id) == false else {
        return
    }

    process(envelope)
    consumedRouteIds.insert(envelope.id)
}
```

이 방식은 같은 envelope이 두 번 emit되는 경우에는 잘 먹힌다.

예를 들어 `latestPendingRoute`가 host attach 시점에 다시 방출됐는데, 이미 subject 경로에서 같은 envelope을 처리했다면 `id`가 같으니 막을 수 있다. 여기까진 괜찮다.

문제는 앱이 **같은 payload로 서로 다른 envelope을 두 개 만들었을 때**였다. 이 경우 `id`는 다르다. envelope id dedupe만 있으면 둘 다 통과한다.

반대로 내용 기반 dedupe만 두면 또 다른 문제가 생긴다. 사용자가 같은 상세 알림을 몇 초 뒤 다시 눌렀는데 "같은 itemID니까 중복"이라고 막아버릴 수 있다.

그래서 두 dedupe은 목적을 나눠서 봤다. 하나로 뭉치면 계속 빈틈이 생겼다.

## 1층: fingerprint dedupe

첫 번째 층은 payload를 route로 정규화한 직후에 뒀다. 같은 내용을 가리키는 푸시가 아주 짧은 시간 안에 두 번 들어오면 하나만 통과시키는 용도다.

```swift
private struct RecentRouteFingerprint {
    let fingerprint: String
    let at: Date
}

private var recentRouteFingerprints: [RecentRouteFingerprint] = []
private let dedupeWindow: TimeInterval = 0.5

func handle(payload: Data) {
    guard let route = AppRoute(payload: payload) else { return }

    let fingerprint = fingerprint(for: route)
    let now = Date()

    recentRouteFingerprints.removeAll {
        now.timeIntervalSince($0.at) > dedupeWindow
    }

    if recentRouteFingerprints.contains(where: { $0.fingerprint == fingerprint }) {
        return
    }

    recentRouteFingerprints.append(
        RecentRouteFingerprint(fingerprint: fingerprint, at: now)
    )

    emit(RouteEnvelope(id: UUID(), route: route, receivedAt: now))
}
```

fingerprint는 route가 가리키는 실제 대상을 기준으로 잡았다.

```swift
private func fingerprint(for route: AppRoute) -> String {
    switch route {
    case let .itemDetail(_, itemID):
        return "item:\(itemID)"

    case let .contentDetail(_, contentID):
        return "content:\(contentID)"

    case let .documentDetail(documentID):
        return "document:\(documentID)"
    }
}
```

여기서 중요한 건 window를 짧게 두는 쪽이었다. 나는 500ms 정도로 잡았다. 너무 길게 잡으면 사용자가 정상적으로 같은 알림을 다시 누른 케이스까지 막을 수 있다. 그건 또 다른 버그다.

이 층은 "진짜 같은 payload가 시스템/앱 경계에서 거의 동시에 두 번 들어온 경우"를 막기 위한 장치에 가깝다.

## 2층: envelope id 소비 추적

두 번째 층은 라우터에 뒀다. 이미 만들어진 envelope이 여러 경로로 emit될 수 있었기 때문이다.

```swift
final class AppRouteManager {
    private var consumedRouteIds = Set<UUID>()

    func isRouteConsumed(_ id: UUID) -> Bool {
        consumedRouteIds.contains(id)
    }

    func markRouteConsumed(_ id: UUID) {
        consumedRouteIds.insert(id)
    }
}
```

라우터는 처리 시작 전에 소비 여부를 확인한다.

```swift
private func consume(envelope: RouteEnvelope) {
    guard routeManager.isRouteConsumed(envelope.id) == false else {
        return
    }

    // route 처리

    routeManager.markRouteConsumed(envelope.id)
}
```

이 층은 "같은 envelope이 pending route와 callback 경로에서 두 번 나온 경우"를 막는 쪽에 가깝다.

## 둘이 막는 문제가 다르다

정리하면 대충 이런 식이다.

|상황|fingerprint dedupe|envelope id dedupe|
|---|---|---|
|같은 payload가 거의 동시에 두 번 들어옴|막음|못 막음|
|같은 envelope이 subject와 pending에서 두 번 emit|대체로 막음|막음|
|같은 화면을 가리키는 다른 알림을 나중에 다시 탭|window 밖이면 통과|통과|
|ready callback과 latest pending이 같은 envelope을 처리|window 밖이면 못 막을 수 있음|막음|

한 층만 있으면 빈틈이 남는다. fingerprint는 내용 중복을 막고, envelope id는 lifecycle 중복을 막는다. 둘이 비슷해 보여도 막는 구멍이 달랐다.

## early return에서도 소비 처리를 했다

여기서 진짜 자주 빠지는 게 있었다. 정상 처리 끝에서만 `markRouteConsumed`를 호출하면 안 됐다.

라우터에는 early return이 많다. 여기서 하나만 빼먹어도 나중에 다시 살아난다.

```swift
private func consume(envelope: RouteEnvelope) {
    guard routeManager.isRouteConsumed(envelope.id) == false else {
        return
    }

    guard let page = envelope.route.targetTab else {
        routeManager.markRouteConsumed(envelope.id)
        return
    }

    guard enabledPages.contains(page) else {
        routeManager.markRouteConsumed(envelope.id)
        return
    }

    guard let host else {
        routeManager.markRouteConsumed(envelope.id)
        return
    }

    // 정상 처리
    routeManager.markRouteConsumed(envelope.id)
}
```

왜 실패한 route도 소비하냐면, 이 envelope은 이미 라우터가 한 번 판단한 이벤트이기 때문이다. `host`가 없어서 실패했는데 pending에 그대로 남겨두면, 다음 attach 때 같은 envelope이 또 들어온다. 그게 무한 재처리의 시작이었다.

정말 재시도가 필요하다면 consumed set이 아니라 별도 retry 정책으로 다루는 게 맞아 보였다.

## async 처리에서는 먼저 소비하는 게 안전했다

처음엔 detail fetch가 끝난 뒤에 consumed 처리했다. 뭔가 성공했을 때만 소비하는 게 더 자연스러워 보여서.

```swift
Task { @MainActor in
    let detail = await detailStore.resolveDetail(for: route)
    host.pushDetail(detail, ...)
    pushManager.markRouteConsumed(envelope.id)
}
```

이러면 fetch가 도는 동안 같은 envelope이 다시 emit될 수 있다. 그러면 Task가 두 개 생기고, 둘 다 detail push까지 갈 수 있다.

그래서 비동기 작업을 시작하기 전에 먼저 소비 처리했다.

```swift
routeManager.markRouteConsumed(envelope.id)

inFlightTask?.cancel()
inFlightTask = Task { @MainActor in
    guard Task.isCancelled == false else { return }

    guard let detail = await detailFactory.resolveDetail(for: route) else {
        return
    }

    guard Task.isCancelled == false else { return }

    host.pushDetail(detail, navigationController: nav, page: page)
}
```

실패하면 어떻게 하냐는 고민이 있었는데, 같은 push를 자동 재시도한다고 성공한다는 보장이 없었다. 오히려 중복 push가 더 위험했다. 그래서 이 라우팅에서는 "소비 후 처리" 쪽이 더 안전해 보였다.

## 정리

푸시 중복 진입은 단순히 `Set` 하나로 끝나지 않았다. 같은 내용이 다른 envelope으로 들어오는 문제와, 같은 envelope이 여러 lifecycle 경로로 다시 emit되는 문제는 서로 달랐다.

그래서 나는 이렇게 나눠서 가져갔다.

- payload 정규화 직후에는 내용 기반 fingerprint dedupe를 둔다
- 라우터에서는 envelope id 소비 추적을 둔다
- fingerprint window는 짧게 둔다
- 라우터의 early return에서도 `markRouteConsumed`를 빼먹지 않는다
- async fetch 전에 먼저 consumed 처리해서 중복 Task 생성을 막는다
- 필요하면 `inFlightTask`를 cancel해서 마지막 라우팅만 살린다

푸시 라우팅은 "대부분 한 번만 들어오겠지"라고 생각하면 꼭 한 번 터진다. 같은 화면이 두 번 쌓인 스크린샷을 보기 싫다면 dedupe는 두 층으로 두는 게 마음 편했다.

관련 검색어: iOS push notification duplicate, Swift push deduplication, Coordinator push routing, cold launch push notification, envelope id dedupe.
