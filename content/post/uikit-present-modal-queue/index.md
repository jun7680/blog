+++
author = "오깅중"
title = "UIKit 모달 여러 개가 동시에 present 될 때 큐로 줄 세운 기록"
slug = "uikit-present-modal-queue"
date = "2026-05-21T10:20:00+09:00"
description = "UIKit에서 여러 publisher가 동시에 modal present를 트리거할 때 생기는 충돌을 priority queue, RunLoop 디바운스, dismiss completion으로 직렬화한 사례."
categories = ["Swift"]
tags = ["UIKit", "Coordinator", "Modal", "present", "UIViewController", "iOS", "DispatchQueue", "Combine"]
+++

앱 진입 직후에 띄워야 하는 모달이 여러 개 있었다.

권한 안내, 튜토리얼, 업데이트 팝업, 서비스 공지... 이런 것들이 각자 다른 publisher에서 자기 타이밍에 신호를 보낸다. 하나씩 보면 다 말이 된다. 근데 실제 앱에서는 거의 동시에 떨어진다.

첫 번째 모달이 `present` 되는 도중에 두 번째 모달이 들어오면 UIKit은 조용히 무시하거나, 콘솔에 익숙한 경고를 뱉는다.

```text
Attempt to present ... whose view is not in the window hierarchy
```

운 좋으면 경고로 끝난다. 운 나쁘면 사용자가 꼭 봐야 하는 안내가 그냥 사라진다. 이게 제일 찝찝했다.

## 처음 구조는 각자 present였다

처음엔 각 트리거가 자기 모달을 바로 띄웠다.

```swift
func showPermissionGuide(types: [PermissionGuideKind]) {
    let coordinator = PermissionGuideCoordinator(...)
    viewController.present(coordinator.viewController, animated: true)
    addChild(coordinator)
}

func showUpdateNotice(payload: UpdateNoticePayload) {
    let coordinator = UpdateNoticeCoordinator(...)
    viewController.present(coordinator.viewController, animated: false)
    addChild(coordinator)
}
```

문제는 이 트리거들이 서로의 존재를 모른다는 거였다.

- 권한 안내: `viewDidAppear` 이후
- 튜토리얼: 신규 사용자 첫 진입 publisher
- 업데이트 팝업: 서버 설정 fetch 결과
- 서비스 공지: 별도 repository publisher

각자 `present(...)`를 호출하면 Coordinator 입장에서는 누가 먼저 도착하는지 알 수 없다. 우연히 순서가 좋으면 정상. 동시에 떨어지면 충돌.

처음엔 "그냥 모달끼리 completion 안에서 chain 시키면 되지 않나?" 싶었다. 근데 트리거가 분산돼 있어서 chain으로 묶기 애매했다. 두 번째 모달은 첫 번째 모달이 뜨는 중인지 모른 채 들어온다.

## 그래서 큐를 뒀다

방향은 단순하게 잡았다.

Coordinator가 모든 modal 요청을 큐로 받고, 한 번에 하나만 띄운다.

```swift
private enum AppModalKind {
    case permissionGuide
    case tutorial
    case updateNotice
    case serviceNotice
}

private enum AppModalRoute {
    case permissionGuide([PermissionGuideKind])
    case tutorial(TutorialKind)
    case updateNotice(UpdateNoticePayload)
    case serviceNotice(ServiceNoticePayload)

    var priority: Int {
        switch self {
        case .permissionGuide:
            return 0
        case .tutorial:
            return 1
        case .updateNotice:
            return 2
        case .serviceNotice:
            return 3
        }
    }

    var kind: AppModalKind {
        switch self {
        case .permissionGuide:
            return .permissionGuide
        case .tutorial:
            return .tutorial
        case .updateNotice:
            return .updateNotice
        case .serviceNotice:
            return .serviceNotice
        }
    }
}

private var modalQueue: [AppModalRoute] = []
private var activeModalRoute: AppModalRoute?
private var isModalPresentationScheduled = false
```

`activeModalRoute`는 지금 떠 있는 모달 슬롯이다. 이 값이 nil일 때만 다음 모달을 꺼낸다.

## enqueue에서는 같은 종류를 최신으로 교체했다

같은 모달이 두 번 쌓이는 것도 막아야 했다. 예를 들어 서버 설정이 두 번 emit되면서 업데이트 팝업이 큐에 두 개 쌓이면 그것도 이상하다.

그래서 같은 kind가 이미 큐에 있으면 최신 payload로 교체했다.

```swift
private func enqueueModal(_ route: AppModalRoute) {
    modalQueue.removeAll { $0.kind == route.kind }
    modalQueue.append(route)
    modalQueue.sort { $0.priority < $1.priority }

    schedulePresentNextModalIfNeeded()
}
```

여기까지는 평범하다. 문제는 이 다음이었다.

## 같은 RunLoop에 들어온 요청은 한 번 모아야 했다

처음엔 `enqueueModal` 안에서 바로 `presentNextModalIfNeeded()`를 호출했다.

근데 이렇게 하면 먼저 들어온 모달이 바로 떠버린다. 같은 RunLoop turn 안에서 더 높은 우선순위 모달이 뒤늦게 enqueue돼도 이미 늦었다.

예를 들어 서비스 공지가 먼저 들어오고, 바로 이어서 권한 안내가 들어온다고 해보자.

- 서비스 공지 enqueue
- 즉시 present
- 권한 안내 enqueue
- 이미 공지가 떠 있으니 권한 안내는 다음 차례로 밀림

우선순위를 둔 의미가 반쯤 사라진다.

그래서 present 트리거를 다음 main queue turn으로 미뤘다.

```swift
private func schedulePresentNextModalIfNeeded() {
    guard isModalPresentationScheduled == false else { return }
    isModalPresentationScheduled = true

    DispatchQueue.main.async { [weak self] in
        self?.isModalPresentationScheduled = false
        self?.presentNextModalIfNeeded()
    }
}
```

이렇게 하면 같은 RunLoop turn에 들어온 enqueue들이 먼저 큐에 쌓인다. 다음 turn에서 정렬이 끝난 큐의 첫 번째 항목만 띄우면 된다.

거창하게 debounce라고 부를 수도 있는데, 실제로는 `DispatchQueue.main.async` 한 번 미루는 정도였다. 근데 이 한 틱이 꽤 중요했다.

## 실제 present는 슬롯을 보고 한 번만

다음 모달을 띄울 때는 내가 관리하는 슬롯과 UIKit의 실제 상태를 같이 봤다.

```swift
private func presentNextModalIfNeeded() {
    guard activeModalRoute == nil,
          viewController.presentedViewController == nil,
          modalQueue.isEmpty == false
    else {
        return
    }

    let route = modalQueue.removeFirst()
    activeModalRoute = route

    presentModal(route)
}
```

처음엔 `activeModalRoute == nil`만 보면 되지 않나 싶었다. 근데 외부 Coordinator나 시스템 alert이 이미 떠 있을 수도 있다. UIKit 입장에서 진짜 present 가능한지는 `presentedViewController`가 더 잘 안다.

그래서 둘 다 봤다.

- `activeModalRoute`: 내가 큐에서 띄운 모달인지
- `presentedViewController`: UIKit이 실제로 뭔가를 띄우고 있는지

둘 중 하나라도 막혀 있으면 기다리는 쪽이 안전했다.

## dismiss completion 안에서 슬롯을 비웠다

다음으로 한 번 더 터진 부분은 dismiss 타이밍이었다.

처음엔 `finishQueuedModal`에서 `activeModalRoute = nil`을 먼저 하고, 바로 다음 모달을 띄웠다. 근데 dismiss 애니메이션이 아직 끝나지 않은 상태라 새 present와 겹쳤다. UIKit 입장에서는 또 "한 ViewController가 두 modal을 동시에 띄우려는" 상황이다.

그래서 슬롯 비우기와 다음 present 예약을 dismiss completion 안으로 넣었다.

```swift
private func finishQueuedModal(_ kind: AppModalKind) {
    modalQueue.removeAll { $0.kind == kind }

    guard activeModalRoute?.kind == kind else {
        schedulePresentNextModalIfNeeded()
        return
    }

    let completion = { [weak self] in
        self?.activeModalRoute = nil
        self?.schedulePresentNextModalIfNeeded()
    }

    detachModalCoordinator(kind: kind, completion: completion)
}
```

이렇게 해야 UIKit의 dismiss 애니메이션이 끝난 뒤에 다음 present가 시작된다.

## child가 이미 없을 때도 completion은 불러야 했다

예외도 있었다.

사용자가 화면을 빠르게 빠져나가거나, dismiss 신호가 두 번 들어오면 두 번째 `finishQueuedModal` 시점에는 child coordinator가 이미 사라져 있을 수 있다.

이때 child를 못 찾았다고 그냥 return하면 문제가 생긴다. completion이 안 불리고, `activeModalRoute`가 계속 남아서 큐가 영구히 막힌다.

그래서 child가 없어도 슬롯은 비우게 했다.

```swift
private func detachModalCoordinator(
    kind: AppModalKind,
    completion: @escaping () -> Void
) {
    guard let child = findModalCoordinator(kind: kind) else {
        completion()
        return
    }

    detachChild(child, animated: true, completion: completion)
}
```

"이미 없으면 성공한 걸로 치고 슬롯만 비운다" 쪽이다. 이게 더 안전했다.

## publisher의 옛 데이터도 조심해야 했다

큐 자체와는 조금 다른 문제인데, 같은 작업에서 같이 잡았다.

서버 설정 기반 팝업 publisher가 로컬 DB를 거쳐서 emit되는 구조였다. 앱 진입 직후 첫 emission은 네트워크 결과가 아니라 <strong>이전 실행 때 저장된 entity</strong>일 수 있다.

그래서 이런 일이 생겼다.

- 앱 진입
- 로컬 DB에 남아 있던 옛 팝업 데이터 emit
- 팝업 present
- 백그라운드 fetch 완료
- 서버에서는 이미 만료된 팝업이라 nil emit

처음 구현은 nil을 무시했다. 그랬더니 옛 데이터 기반 팝업이 계속 살아남았다. 서버에서 만료시킨 공지가 사용자 앱에선 계속 보이는 상황이다.

그래서 nil도 의미 있는 emission으로 봤다.

```swift
publisher
    .sink { [weak self] payload in
        if let payload {
            self?.enqueueModal(.updateNotice(payload))
        } else {
            self?.finishQueuedModal(.updateNotice)
        }
    }
```

`finishQueuedModal`은 child가 없으면 no-op에 가깝게 끝나기 때문에 안전했다.

## reset 때 큐도 같이 비웠다

로그아웃 후 재로그인처럼 루트 화면을 새로 시작하는 경우도 있었다.

이때 이전 세션의 큐가 살아 있으면 새 세션 위에 옛 모달이 뜰 수 있다. 이런 버그는 한 번 보면 되게 찝찝하다.

```swift
func resetModalQueue() {
    modalQueue.removeAll()
    activeModalRoute = nil
    isModalPresentationScheduled = false
}
```

루트 화면 reset이나 Coordinator 재시작 시점에는 큐도 같이 비웠다.

## 정리

UIKit modal present는 사실상 한 슬롯이라고 봐야 했다. 여러 publisher가 동시에 `present`를 트리거할 수 있으면, 우연히 잘 돌아가는 날도 있지만 언젠가는 충돌한다.

이번 작업은 대충 이렇게 가져갔다.

- modal 요청은 바로 present하지 않고 큐에 넣는다
- 같은 종류의 modal은 최신 payload로 교체한다
- 같은 RunLoop turn에 들어온 enqueue는 다음 turn까지 모은다
- `activeModalRoute`와 `presentedViewController`를 같이 본다
- dismiss completion 안에서 슬롯을 비우고 다음 modal을 예약한다
- child coordinator가 이미 없어도 completion은 호출한다
- DB/cache 기반 publisher의 nil emission도 의미 있게 처리한다
- 화면 reset 때 modal queue도 같이 비운다

결국 핵심은 "누가 먼저 present를 호출했냐"를 믿지 않는 쪽이었다. 트리거가 분산돼 있으면 도착 순서는 매번 달라진다. 그러면 Coordinator 한 곳에서 줄 세우는 게 제일 덜 불안했다.

관련 검색어: UIKit modal present queue, Attempt to present whose view is not in the window hierarchy, Coordinator modal queue, Combine publisher initial emission, DispatchQueue main async debounce.
