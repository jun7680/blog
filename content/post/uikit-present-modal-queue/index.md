+++
author = "오깅중"
title = "UIKit present로 모달 두 개 동시에 띄우려다 만난 'whose view not in window hierarchy' — 큐잉 패턴"
slug = "uikit-present-modal-queue"
date = "2026-05-15T15:30:00+09:00"
description = "UIKit present로 모달 순서대로 띄우려는데 두 번째가 안 뜨고 'whose view is not in the window hierarchy' 경고가 떴다. 비동기로 도착하는 모달 4종을 priority queue + 슬롯 + 디바운스로 줄세운 패턴 정리."
categories = ["Swift"]
tags = ["UIKit", "Coordinator", "Modal", "present", "UIViewController", "iOS", "DispatchQueue", "모달 순서대로 띄우기"]
+++

앱 진입 직후 권한 안내, 튜토리얼, 업데이트 팝업, 공지 — 네 종류의 모달이 비동기로 도착한다. 어떤 날은 튜토리얼 위로 업데이트 팝업이 정상적으로 뜨고, 어떤 날은 두 번째가 그냥 안 뜬다. 콘솔엔 익숙한 경고가 남는다.

```
Attempt to present <UpdatePopupViewController> on <RootViewController>
whose view is not in the window hierarchy.
```

UIKit의 `present(_:animated:)`는 한 ViewController에서 동시에 두 개를 못 띄운다. 두 번째 호출은 무시되거나 위 경고를 뱉고 끝남. "그러면 모달을 순서대로 띄우려면 어떻게 줄을 세우지?"가 이 글의 주제다.

## 뭐가 문제였나

처음 구조는 단순했다. 각 도메인이 각자 트리거를 가지고 Coordinator의 `route*` 메서드를 호출.

```swift
// 권한 안내
func showPermissionGuide(types: [PermissionGuideType]) {
    let coordinator = PermissionGuideCoordinator(...)
    viewController.present(coordinator.viewController, animated: true)
    addChild(coordinator)
}

// 업데이트 팝업
func showUpdatePopup(payload: UpdatePopupPayload) {
    let coordinator = UpdatePopupCoordinator(...)
    viewController.present(coordinator.viewController, animated: false)
    addChild(coordinator)
}
```

각 트리거가 비동기로 도착하니까 같은 RunLoop tick 안에 두 번째 `present`가 들어오는 경합이 생긴다. 게다가 어떤 트리거는 디바이스 권한 상태 조회 결과를 기다리고, 어떤 트리거는 서버 응답 디코딩을 기다림. 호출 순서를 코드로 강제할 수가 없다.

## 해결 — priority queue + 슬롯 + 디바운스

세 가지 부품으로 잘랐다.

### 1) 큐 entry와 priority

```swift
private enum ModalRoute {
    case updatePopup(UpdatePopupPayload)
    case permissionGuide([PermissionGuideType])
    case announcement(AnnouncementModel)
    case tutorial(TutorialKind)

    var priority: Int {
        switch self {
        case .permissionGuide: return 0
        case .tutorial:        return 1
        case .updatePopup:     return 2
        case .announcement:    return 3
        }
    }
}
```

`ModalRoute` 한 case 안에 화면을 그리는 데 필요한 payload를 같이 들고 다닌다. 정렬은 priority 오름차순.

### 2) 슬롯 + enqueue

```swift
private var modalQueue: [ModalRoute] = []
private var activeModalRoute: ModalRoute?
private var isModalPresentationScheduled = false

private func enqueueModal(_ route: ModalRoute) {
    modalQueue.removeAll { $0.kind == route.kind }   // 동일 종류는 최신으로 교체
    modalQueue.append(route)
    modalQueue.sort { $0.priority < $1.priority }
    schedulePresentNextModalIfNeeded()
}
```

`activeModalRoute`가 "지금 화면에 떠있는 모달"을 가리키는 슬롯. nil이면 큐의 다음 항목을 꺼낼 수 있다.

### 3) 디바운스 + 실제 present

```swift
private func schedulePresentNextModalIfNeeded() {
    guard isModalPresentationScheduled == false else { return }
    isModalPresentationScheduled = true

    DispatchQueue.main.async { [weak self] in
        self?.isModalPresentationScheduled = false
        self?.presentNextModalIfNeeded()
    }
}

private func presentNextModalIfNeeded() {
    guard activeModalRoute == nil,
          viewController.presentedViewController == nil,
          modalQueue.isEmpty == false
    else { return }

    let route = modalQueue.removeFirst()
    activeModalRoute = route
    presentModal(route)
}
```

같은 RunLoop tick 안에서 `enqueueModal`이 N번 호출돼도 present 트리거는 단 한 번만 예약된다. 모든 enqueue가 끝난 다음 turn에 한 번 실행되니까 큐가 priority 정렬을 마친 상태에서 가장 앞 항목이 노출됨.

### 4) dismiss 시 슬롯 해제 + 다음 모달

```swift
private func finishQueuedModal(_ kind: ModalKind) {
    modalQueue.removeAll { $0.kind == kind }

    guard activeModalRoute?.kind == kind else {
        schedulePresentNextModalIfNeeded()
        return
    }

    // detach 애니메이션이 끝난 다음에야 슬롯을 비워야
    // 다음 present가 겹치지 않는다.
    let completion = { [weak self] in
        self?.activeModalRoute = nil
        self?.schedulePresentNextModalIfNeeded()
    }

    removeChild(type: ..., action: completion)
}
```

여기 포인트는 **completion 안에서 슬롯을 비운다**는 것. detach 애니메이션이 0.3초쯤 걸리는데, 그 사이에 다음 모달이 들어오면 다시 같은 경합이 난다.

## 왜 `presentedViewController == nil`까지 보는가

`activeModalRoute == nil` 하나로 충분할 것 같지만 아니다. 외부에서(예: 다른 Coordinator, 또는 시스템 alert) 이미 모달을 띄운 상태일 수도 있음. UIKit의 실제 present 가능 여부 진실은 `presentedViewController`가 들고 있으므로 그쪽도 같이 본다. 슬롯 두 개(`active...` + `presented...`)가 다른 정보를 제공함.

## 루트 화면 reset 시 큐도 전부 비우기

로그아웃 후 재로그인처럼 루트 화면을 새로 시작하는 경우, 이전 세션의 큐가 살아있으면 새 세션 위에 옛 모달이 떠버린다.

```swift
func resetModalStack() {
    modalQueue.removeAll()
    activeModalRoute = nil
    isModalPresentationScheduled = false
    ...
}
```

이 세 줄 빼먹으면 로그아웃 → 로그인 했더니 옛 사용자 기준의 업데이트 팝업이 새 사용자에게 뜨는 회귀가 난다. 한 번 당했다.

## 왜 `OperationQueue` 안 썼나

처음엔 `OperationQueue(maxConcurrentOperationCount: 1)`도 검토했다. 안 쓴 이유:

- priority 동적 재정렬이 자연스럽지 않다 (operation은 이미 큐에 들어간 뒤 우선순위 변경이 까다로움)
- `present`의 completion 콜백을 operation 종료 시점과 묶는 코드가 오히려 더 verbose
- 외부에서 띄운 모달(`presentedViewController`)까지 봐야 해서 어차피 `isReady` 가드가 필요

그냥 배열 + main queue 디바운스가 코드량/디버깅 가성비 최고였다.

## 교훈

- UIKit `present`는 단일 슬롯이다. 비동기 트리거가 둘 이상이면 무조건 줄을 세워야 한다.
- 슬롯 해제는 **detach 애니메이션 completion 안에서** 해야 다음 present와 겹치지 않는다.
- 같은 RunLoop 안 다중 enqueue는 `DispatchQueue.main.async` + 가드 플래그로 디바운스. 모든 enqueue가 끝난 뒤의 정렬 상태로 노출됨.
- "지금 모달 떠있는지"의 진실은 `presentedViewController`. 내 슬롯 변수만 믿지 말 것.
- Coordinator 재진입(reset) 시 큐도 함께 비울 것. 이전 세션 잔재가 새 세션 위에 뜬다.

### 점검 체크리스트

- [ ] `present` 호출 직전에 다른 모달이 떠있을 가능성이 있는가?
- [ ] dismiss 후 다음 모달까지의 시점에 새 trigger가 들어올 수 있는가?
- [ ] 같은 RunLoop 안에서 enqueue가 여러 번 일어날 수 있는가?
- [ ] 화면 reset 시 큐 정리 코드가 들어가 있는가?
