+++
author = "오깅중"
title = "Coordinator 패턴에서 부모 없는 외부 진입이 만드는 delegate nil 함정"
slug = "coordinator-external-entry-no-parent"
date = "2026-05-22T09:40:00+09:00"
description = "푸시나 딥링크로 상세 화면을 직접 열 때 부모 Coordinator가 없어 delegate nil로 종료 흐름이 멈춘 문제와 fallback 처리 기록."
categories = ["Swift"]
tags = ["iOS", "Swift", "Coordinator", "MVVMC", "PushNotification", "DeepLink", "UIKit"]
+++

MVVM+C 구조에서 상세 화면을 열고 닫는 흐름은 보통 부모 Coordinator가 관리한다.

리스트에서 셀을 탭하면 리스트 Coordinator가 상세 Coordinator를 만들고, 상세가 끝났다는 delegate 콜백을 받는다. 너무 익숙한 구조다. 그래서 오히려 의심을 안 했다.

문제는 푸시 알림으로 상세 화면을 바로 열었을 때였다. 상세 안에서 액션을 마치면 리스트로 돌아가야 하는데, 화면이 그대로 멈췄다. 모달은 닫혔는데 detail VC가 navigation stack에 남아 있었다.

원인은 한 줄이었다.

## delegate가 nil이었다

상세 ViewModel의 종료 콜백은 이런 모양이었다.

```swift
func detachAction() {
    controllable?.shutdownAction {
        self?.detailDelegate?.detachDetail()
    }
}
```

셀 탭 진입에서는 잘 된다. 부모 Coordinator가 자기 자신을 `detailDelegate`로 넣기 때문이다.

그런데 푸시 진입에서는 부모가 없다. 라우터가 상세 Coordinator를 직접 만들고 navigation controller에 push만 한다. 그러면 `detailDelegate`는 nil이다.

문제는 여기서 optional chaining이 너무 조용하다는 점이다.

```swift
self?.detailDelegate?.detachDetail()
```

delegate가 없으면 그냥 아무 일도 안 한다. 에러도 없고, 로그도 없고, 화면만 안 닫힌다. 디버깅하는 입장에서는 제일 찝찝한 실패다.

## Coordinator도 부모를 전제하고 있었다

ViewModel 콜백만의 문제가 아니었다. Coordinator의 종료 함수도 비슷했다.

```swift
func shutdown() {
    sceneFinishDelegate?.finish(to: self)
}
```

이 코드도 앱 내부 진입에서는 자연스럽다. 부모가 child coordinator를 정리해야 하니까, 종료를 부모에게 위임한다.

하지만 외부 진입에서는 얘기가 달라진다.

- 푸시 알림
- 딥링크
- 유니버설 링크
- 위젯 진입

이런 경로는 시스템에서 시작된다. 화면은 같은 상세 화면이지만, 생성 경로에는 부모 리스트가 없을 수 있다. 그러면 종료 책임을 위임할 대상도 없다.

즉, "모든 상세 화면은 부모 Coordinator가 만든다"는 가정은 앱 내부 플로우에서만 맞았다.

## 가장 작은 해결: delegate 우선, 없으면 직접 pop

처음에는 라우터가 delegate를 주입하도록 바꾸는 방법도 생각했다. 구조적으로는 그럴듯하다. 외부 진입용 host 프로토콜을 넓히고, 라우터가 상세 종료까지 관리하게 만들 수 있다.

그런데 이번 문제의 핵심은 더 단순했다.

외부 진입으로 열린 Coordinator는 부모가 없어도 자기 화면 하나는 닫을 수 있어야 한다.

그래서 `shutdown()`에 fallback을 뒀다.

```swift
func shutdown() {
    if let sceneFinishDelegate {
        sceneFinishDelegate.finish(to: self)
    } else {
        navigationController.popViewController(animated: true)
    }
}
```

그리고 ViewModel 콜백도 delegate가 없으면 coordinator 종료로 빠지게 했다.

```swift
func detachAction() {
    controllable?.shutdownAction { [weak self] in
        if let delegate = self?.detailDelegate {
            delegate.detachDetail()
        } else {
            self?.controllable?.shutdown()
        }
    }
}
```

이렇게 하면 내부 진입은 기존처럼 부모 Coordinator가 정리한다. 외부 진입은 자기 navigation stack에서 직접 빠진다. 책임이 크게 흔들리지 않으면서도 멈춤은 사라졌다.

## 왜 라우터 주입보다 fallback을 택했나

라우터에서 delegate를 세팅하는 방식도 가능하다. 다만 그러려면 외부 진입 host가 상세 종료까지 알아야 한다.

내 경우에는 그게 오히려 의존성을 넓히는 느낌이었다. 라우터의 역할은 "어떤 화면으로 보낼지"에 가깝고, 상세 화면 내부 액션 이후의 종료 정책까지 알 필요는 없었다.

반대로 `shutdown()` fallback은 Coordinator 자신의 책임 안에 있다.

- 부모가 있으면 부모에게 종료를 알림
- 부모가 없으면 자신이 push한 화면을 pop

이 규칙은 푸시뿐 아니라 딥링크, 유니버설 링크에도 그대로 적용된다. 그래서 더 작고 오래 가는 수정이라고 봤다.

## optional delegate는 실패를 숨기기 쉽다

이번에 다시 느낀 건 `weak var delegate`와 optional chaining 조합의 위험함이다.

```swift
delegate?.didFinish()
```

이 한 줄은 깔끔하다. 그런데 delegate가 반드시 있어야 하는 흐름이라면, nil일 때 조용히 끝나는 게 버그를 숨긴다.

특히 외부 진입에서는 nil이 비정상이 아니라 정상 상태일 수 있다. 그러면 둘 중 하나는 해야 한다.

- nil일 때의 fallback을 명시한다
- nil이면 안 되는 경로라면 로그나 assertion으로 드러낸다

아무 일도 안 하는 상태가 제일 안 좋았다. 사용자 입장에서는 화면이 멈춘 것처럼 보이고, 개발자 입장에서는 콜백이 호출됐는지조차 흐려진다.

## 정리

Coordinator 패턴에서 부모 Coordinator는 편한 가정이다. 하지만 모든 진입이 앱 내부에서 시작되지는 않는다.

외부 진입으로 상세 화면을 직접 열 수 있다면, 그 상세 Coordinator는 부모 없이도 최소한 자기 종료는 처리할 수 있어야 한다. 내 기준은 이제 이렇다.

- 내부 진입: 부모 delegate로 종료 위임
- 외부 진입: delegate가 없으면 직접 pop
- delegate nil이 의미 있는 상태라면 코드에 fallback을 남김

작은 fallback 하나였지만, 콜드스타트 푸시에서 사용자가 빠져나오지 못하던 문제를 끝냈다. 다음에 detail 화면을 만들 때는 "이 화면이 딥링크로 바로 열리면 닫힐 수 있나?"부터 먼저 보려고 한다.

## 점검 체크리스트

- 외부 진입 가능한 detail 화면을 식별했는가
- 각 detail Coordinator의 `shutdown()`이 부모 없이도 dismiss 가능한가
- delegate 기반 종료 콜백에 fallback이 있는가
- delegate nil이 의도된 상태인지, 버그인지 구분되어 있는가
- optional chaining으로 종료 실패가 조용히 묻히지 않는가

