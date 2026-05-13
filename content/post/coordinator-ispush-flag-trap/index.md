+++
author = "오깅중"
title = "isPush 플래그가 만드는 Coordinator 흐름 분기 지옥"
slug = "coordinator-ispush-flag-trap"
date = "2026-05-13T14:15:00+09:00"
description = "푸시 진입과 일반 진입을 isPush 플래그로 가르는 순간, dismiss 경로가 두 갈래로 갈리고 cascade finish가 의도와 정반대로 동작한다. 분기 자체가 정책과 어긋난 사례."
categories = ["Swift"]
tags = ["Coordinator", "UIKit", "Navigation", "PushNotification", "Debugging"]
+++

어느 날 푸시 알림으로 특정 화면에 들어가 작업을 완료하면 본문에 그대로 머무는 버그를 받았다. 일반 진입(리스트 → 상세 → 작업)에선 정상 동작, **푸시 진입에서만** 작업 후 리스트로 돌아오지 않음. 한참 봤더니 Coordinator 패턴에서 흔히 만들어지는 "진입 경로별 분기 트랩"이었다. 정리해 둔다.

## Coordinator 체인

문제 화면의 Coordinator 트리는 대략 이런 모양.

```
HomeCoordinator
└─ ItemTabCoordinator (isPush=true)
    └─ ItemListCoordinator (build 시 isPush 전달)
        └─ ItemDetailCoordinator
            └─ ConfirmCoordinator
```

푸시 진입과 일반 진입에서 동일한 트리를 빌드하되, **푸시일 때만 `isPush=true` 플래그가 위에서부터 cascade**로 흘러 내려오는 구조.

## 무엇이 일어났는가

작업 완료 후 종료 흐름은 푸시/일반 모두 동일하게 `Detail.shutdown(isSwipe: false)` → `List.shutdownItem(isSwipe: false)`로 진입한다. 그런데 `shutdownItem`에 이런 분기가 있었다.

```swift
func shutdownItem(isSwipe: Bool) {
    if isPush {
        sceneFinishDelegate?.finish(to: self)   // ListCoord 자신을 finish
    } else {
        detachChild(type: ItemDetailCoordinator.self)
    }
}
```

`isPush=true` 분기는 ListCoord가 **자기 자신을 부모(TabCoord)에게 finish 시킨다**. TabCoord의 finish도 isPush 분기를 가지고 있어서 더 위로 cascade.

그 결과:

- Detail VC는 **단 한 번도 detach/pop되지 않음**
- List/TabCoord는 정리되지만 Detail VC는 nav 스택에 그대로 남음

"본문에 머무르는" 증상이 정확히 이것이었다. 위쪽 Coordinator는 다 정리됐지만 가장 안쪽 VC는 화면에 살아있는, 잘 보면 무서운 상태.

## 원래 분기의 의도

코드를 짤 당시의 의도는 짐작 가능하다. "푸시 진입이면 작업 끝나고 화면 자체를 닫고 홈으로" 정책이었을 것이다. 하지만 실제 요구사항을 다시 확인해 보면 "푸시든 아니든 작업 후 리스트로 복귀". **분기 자체가 정책과 어긋났다**.

또 하나, 분기를 만든 시점엔 한 단계만 보면 됐을 수 있다. 그런데 시간이 지나면서 부모 Coordinator에도 같은 isPush 분기가 추가됐고, 그 cascade가 "내가 의도하지 않은 곳"까지 영향을 미친 것.

## 해결

분기를 제거하고 dismiss 경로를 단일화.

```swift
func shutdownItem(isSwipe: Bool) {
    if isSwipe {
        detachChildCoordinator(type: ItemDetailCoordinator.self)
    } else {
        detachChild(type: ItemDetailCoordinator.self)
    }
}
```

`isPush` 분기 제거. 푸시/일반 모두 동일한 dismiss 경로로 통일. 결과적으로 작업 완료 후 항상 리스트로 복귀.

## 같은 패턴이 자주 만들어지는 자리

이 함정은 isPush뿐 아니라 진입 경로를 플래그로 추적할 때 어디서나 만들어진다.

- `isDeepLink` — 딥링크 진입이면 다르게
- `isModal` — 모달이면 다르게
- `isFromOnboarding` — 온보딩에서 왔으면 다르게

플래그를 받는 순간 dismiss/완료 경로가 두 갈래로 갈리고, 시간이 지나면 그 갈래 중 하나가 의도와 다르게 동작하는 모순이 발생한다. 진입 경로 추적은 **시작 시점에만** 의미가 있는데, 종료 시점의 분기까지 같은 플래그로 표현하면서 문제가 생긴다.

## 교훈

"푸시 진입은 일반 진입과 다르다"고 가정하고 isPush 플래그를 받는 순간, dismiss 경로가 두 갈래로 분리된다. 두 갈래는 처음엔 잘 작동하지만, 누군가 위에서 cascade finish를 호출하면 한쪽이 의도와 정반대로 동작한다.

흐름 분기를 추가하기 전에 한 번 더 묻자.

- **이 분기가 진짜 두 가지 다른 동작을 요구하는 비즈니스 요구사항인가?**
- 아니면 단지 진입 경로가 다른 것뿐인가?

진입 경로가 다른 것뿐이라면 분기를 만들지 말고 동일한 흐름을 유지하자. 진입은 분기, **종료는 통일** — 이 규칙 하나만 지켜도 Coordinator 패턴이 한결 안전해진다.
