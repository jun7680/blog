+++
author = "오깅중"
title = "Coordinator re-attach 때 생기는 deinit race window 막기"
slug = "coordinator-reattach-race"
date = "2026-05-21T09:48:00+09:00"
description = "UIKit Coordinator를 재부착하는 순간 old coordinator deinit과 외부 push/deeplink 이벤트가 겹치며 생기는 race window를 막는 방법."
categories = ["Swift"]
tags = ["iOS", "Coordinator", "UIKit", "Memory", "RaceCondition", "Debugging"]
+++

Coordinator 패턴을 쓰다 보면 특정 list coordinator를 다시 붙이는 코드가 생긴다. 푸시로 특정 탭에 진입하거나, 기존 stack을 정리한 뒤 새 list를 만들어야 하는 경우가 그렇다.

문제는 이 re-attach 타이밍에 외부 이벤트가 같이 들어올 때였다. 이게 생각보다 미묘했다.

old coordinator의 강참조를 끊는 바로 그 순간, push/deeplink 이벤트가 old coordinator로 들어가면 이상한 일이 벌어진다. 같은 detail이 두 번 push되거나, 이미 정리 중인 viewController를 만져서 크래시가 난다.

이 글은 그 race window를 막으면서 정리해둔 내용이다.

## 문제가 된 코드는 이런 모양이었다

기존 list를 지우고 새 list를 붙이는 코드가 있었다.

```swift
final class ItemListTabCoordinator: BaseCoordinator {
    private var listCoordinators: [ItemListCoordinator] = []

    func attachList(for context: ListContext) {
        if listCoordinators.isEmpty == false {
            (viewController as? ItemListTabViewController)?.clearList()

            childCoordinators.removeAll {
                $0 is ItemListCoordinator
            }

            listCoordinators.removeAll()
        }

        let newCoordinator = ItemListCoordinator(...)
        listCoordinators.append(newCoordinator)
        childCoordinators.append(newCoordinator)

        newCoordinator.build(context: context)
    }
}
```

코드만 보면 평범하다. 기존 list 정리하고 새 list 붙인다. 근데 외부 이벤트가 있는 앱에서는 이게 race를 만들 수 있었다.

## race window는 removeAll 근처에서 열린다

`listCoordinators.removeAll()`은 old coordinator의 강참조를 끊는다. 그 순간 참조가 0이 되면 `deinit`이 시작된다.

문제는 같은 메인 runloop 안에서 외부 이벤트가 sync로 전달될 수 있다는 점이었다. 즉, "지웠으니까 끝"이 아니었다.

```swift
pushSubject.send(envelope)
```

Combine이나 Rx 계열 subject의 `send`/`onNext`는 보통 현재 call stack에서 구독자를 바로 호출한다. 만약 old coordinator가 아직 구독자로 남아 있거나, 라우터 어딘가에서 old coordinator reference를 들고 있으면 이런 흐름이 가능했다.

```text
frame N:
  old coordinator removeAll()
  old coordinator deinit 시작
  new coordinator append 전/후 어딘가

frame N + 아주 조금:
  pushSubject.send(envelope)
  oldCoordinator.consumeRouteAction(...)
  oldCoordinator.viewController 접근
```

증상은 하나로 고정되지 않았다.

- old coordinator가 detail을 한 번 더 push한다
- 새 coordinator도 같은 detail을 push해서 화면이 두 개 쌓인다
- old coordinator의 viewController가 이미 정리돼 있어서 crash가 난다
- attach가 끝나기 전에 route가 들어와서 조용히 실패한다

타이밍 버그라 재현도 애매하다. 그런데 한 번 로그를 박아보면 거의 같은 timestamp에 `deinit`과 `consume`이 찍힌다. 그때부터는 아... 이거구나 싶다.

## 임시 방어: 강참조 해제를 한 틱 늦춘다

가장 빠른 방어는 old coordinator를 바로 해제하지 않고 다음 runloop tick까지 잡아두는 쪽이었다. 엄청 우아한 해결은 아니지만 급할 땐 효과가 있었다.

```swift
func attachList(for context: ListContext) {
    if listCoordinators.isEmpty == false {
        let oldCoordinators = listCoordinators

        listCoordinators.removeAll()
        childCoordinators.removeAll {
            $0 is ItemListCoordinator
        }

        DispatchQueue.main.async { [weak self] in
            _ = oldCoordinators
            (self?.viewController as? ItemListTabViewController)?.clearList()
        }
    }

    let newCoordinator = ItemListCoordinator(...)
    listCoordinators.append(newCoordinator)
    childCoordinators.append(newCoordinator)

    newCoordinator.build(context: context)
}
```

이렇게 하면 old coordinator의 실제 해제가 다음 main queue turn으로 밀린다. 같은 frame에서 sync로 들어오는 이벤트가 있다면, 적어도 deinit 중인 객체를 건드리는 상황은 줄어든다.

다만 이건 임시 방어에 가깝다. "왜 한 틱 미루는지"를 모르는 사람이 보면 지워버리기 쉽고, 외부 이벤트 라우팅 구조 자체가 좋아진 건 아니다.

그래도 급한 crash를 막는 용도로는 효과가 있었다.

## 더 좋은 해결: 외부 이벤트를 list에서 떼어낸다

좀 더 근본적으로는 list coordinator가 push/deeplink 같은 외부 이벤트를 직접 받지 않게 빼는 쪽이 맞아 보였다.

Before는 이런 식이었다.

```swift
final class ItemListCoordinator {
    init(...) {
        AppRouteManager.shared.eventSubject
            .sink { [weak self] envelope in
                self?.consume(envelope)
            }
            .store(in: &cancellables)
    }
}
```

이 구조에서는 list coordinator가 사라지는 순간에도 외부 이벤트와 lifecycle이 얽힌다. 이게 제일 찜찜했다.

After는 라우터 단일 진입점으로 옮겼다.

```swift
final class AppNavigationRouter {
    private func consume(envelope: RouteEnvelope) {
        host.selectTab(for: page) { [weak self] in
            Task { @MainActor in
                guard let nav = self?.host.ensureServiceListAttached(for: route) else {
                    return
                }

                guard let detail = await self?.detailStore.resolveDetail(
                    for: route,
                    navigationController: nav
                ) else {
                    return
                }

                self?.host.pushDetail(
                    detail,
                    navigationController: nav,
                    page: page
                )
            }
        }
    }
}
```

이제 list coordinator는 외부 push 이벤트를 모른다. 라우터가 host에게 "list가 붙어 있는지 확인해줘"라고 요청하고, attach가 끝난 navigation controller에 detail을 push한다.

여기서 전제는 `ensureServiceListAttached`가 동기적으로 attach 완료를 보장해야 한다는 점이었다. 이름만 ensure면 안 되고, 진짜 ensure여야 했다.

```swift
func ensureServiceListAttached(for route: AppRoute) -> UINavigationController? {
    if let nav = currentListNavigationController() {
        return nav
    }

    attachList(for: route.context)

    return currentListNavigationController()
}
```

이 함수가 "나중에 붙을 예정" 상태로 반환하면 race가 다시 열린다. 이름 그대로 ensure라면 반환 시점에는 list와 navigation이 준비되어 있어야 했다.

## lifecycle state를 명시하는 방법도 있다

모든 외부 이벤트를 한 번에 정리하기 어렵다면 coordinator에 lifecycle state를 두는 것도 방법이었다.

```swift
final class ItemListCoordinator {
    enum State {
        case attaching
        case attached
        case detaching
    }

    private(set) var state: State = .attaching

    func build(context: ListContext) {
        // viewController 구성
        state = .attached
    }

    func consume(action: DeepLinkAction) {
        guard state == .attached else {
            return
        }

        // 외부 이벤트 처리
    }

    func detach() {
        state = .detaching
        // 정리
    }
}
```

이 방식의 장점은 의도가 코드에 남는다는 점이었다. detaching 상태에서는 이벤트를 받지 않는다. attaching 상태에서도 detail push를 하지 않는다. 적어도 상태가 말로 보인다.

단점은 모든 coordinator에 이 상태 전이를 제대로 심어야 한다는 거였다. 한두 곳만 고치면 오히려 "어디는 state 보고 어디는 안 보는" 애매한 구조가 된다.

## 디버깅은 timestamp부터 찍었다

race는 감으로 잡기 어렵다. 그래서 먼저 deinit과 이벤트 소비 시점에 로그를 박았다.

```swift
deinit {
    print("[\(type(of: self))] deinit:", Date().timeIntervalSince1970)
}

func consume(action: DeepLinkAction) {
    print("[\(type(of: self))] consume:", Date().timeIntervalSince1970)
}
```

둘이 거의 같은 timestamp에 찍히면 race 가능성이 높다. 여기에 `Thread.callStackSymbols`를 잠깐 붙이면 old coordinator로 누가 이벤트를 보냈는지도 찾을 수 있다.

```swift
print(Thread.callStackSymbols.joined(separator: "\n"))
```

이런 로그는 오래 남기면 시끄럽지만, race 잡을 때는 꽤 도움이 됐다.

## 정리

Coordinator re-attach 버그는 "removeAll 했는데 왜 아직 이벤트가 들어오지?"에서 시작했다. 다시 보면 lifecycle과 외부 이벤트가 같은 frame에서 겹칠 수 있다는 얘기였다.

이번엔 대충 이렇게 정리했다.

- coordinator 강참조를 끊는 순간 외부 sync 이벤트가 들어올 수 있다
- 급한 방어로는 old coordinator 해제를 `DispatchQueue.main.async`로 한 틱 미룰 수 있다
- 근본적으로는 push/deeplink를 list coordinator가 직접 구독하지 않게 빼는 게 나았다
- `ensureServiceListAttached`는 반환 시점에 attach가 끝나 있어야 했다
- 필요하면 `attaching / attached / detaching` state로 이벤트 수신 가능 상태를 보이게 둔다
- race 의심 시 `deinit`과 `consume` timestamp를 같이 찍어본다

Coordinator 패턴은 화면 흐름을 잘 나눠주지만, 외부 이벤트까지 각 coordinator가 직접 받기 시작하면 lifecycle이 금방 복잡해진다. 푸시나 딥링크는 최대한 위쪽의 단일 라우터에서 잡고, 화면 coordinator는 화면 안쪽 흐름에 집중시키는 편이 훨씬 마음이 편했다.

관련 검색어: iOS Coordinator deinit race, UIKit Coordinator lifecycle, Swift EXC_BAD_ACCESS Coordinator, push notification duplicate screen, Coordinator reattach.
