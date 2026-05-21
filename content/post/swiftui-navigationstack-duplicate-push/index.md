+++
author = "오깅중"
title = "NavigationStack에서 화면이 두 번 쌓이는 세 가지 케이스"
slug = "swiftui-navigationstack-duplicate-push"
date = "2026-05-21T14:13:36+09:00"
description = "SwiftUI NavigationStack에서 같은 화면이 두 번씩 쌓이는 세 가지 케이스와 어떻게 정리했는지 기록"
categories = ["SwiftUI"]
tags = ["SwiftUI", "NavigationStack", "Navigation", "iOS17"]
+++

UIKit에서 화면 쌓던 감각으로 SwiftUI `NavigationStack`을 다루다 보면 어딘가에서 한 번씩 같은 화면이 두 개 쌓여 있다. 뒤로 가기를 두 번 눌러야 원래 화면으로 돌아오는 그 상황이다.

`UINavigationController.pushViewController`는 "지금 한 번 push해라"라는 명령이라 한 번 부르면 한 번 들어가지만 `NavigationStack`은 `path: [Route]` 배열을 그대로 반영하는 모델이라서 같은 값을 두 번 넣으면 같은 화면이 두 번 쌓이게 된다. 멘탈 모델이 어긋나면서 매번 중복 push가 났다.

자주 걸린 케이스가 셋이라 한 번 정리해둔다.

## 1. 버튼 연타에 path가 두 번 늘어남

가장 흔한 케이스다.

```swift
enum Route: Hashable {
    case detail(id: String)
}

struct ListView: View {
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            Button("상세 보기") {
                path.append(.detail(id: "42"))
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .detail(let id): DetailView(id: id)
                }
            }
        }
    }
}
```

탭 반응이 살짝 느리거나 사용자가 두 번 연속 누르면 `[.detail("42"), .detail("42")]`가 그대로 쌓이고 뒤로 두 번 빠져야 원래 화면으로 돌아온다.

해결은 두 갈래다.

가능하면 `NavigationLink(value:)`로 옮긴다. 트리거가 view 안에서 선언적으로 잡히고 연타 방어도 SwiftUI가 어느 정도 알아서 해준다.

```swift
NavigationLink(value: Route.detail(id: "42")) {
    Text("상세 보기")
}
```

UI 흐름상 코드로 path를 만져야 하면 append 직전에 마지막 원소를 보면 된다.

```swift
func push(_ route: Route) {
    if path.last != route {
        path.append(route)
    }
}
```

`Route`가 `Hashable & Equatable`이라 `path.last == route` 비교가 그대로 먹어서 같은 값을 연속으로 넣으려는 시도를 바로 차단해버린다.

## 2. 비동기 작업 완료 시점마다 push

async/await가 끼면 조건이 한 겹 더 붙는다.

```swift
Button("결제하기") {
    Task {
        let result = await checkout()
        if result.isSuccess {
            path.append(.receipt(orderId: result.orderId))
        }
    }
}
```

응답이 늦어지는 동안 사용자가 한 번 더 누르면 두 번째 `Task`가 또 떠 있다가 완료 시점에 또 `path.append`를 부르는데 운 나쁘면 영수증이 두 번 쌓이고 더 안 좋게는 두 번째 task가 다른 orderId로 push하면서 사용자가 본 결과와 다른 화면이 들어간다.

이런 흐름은 view 차원의 loading guard로 끊는 게 깔끔하다.

```swift
@State private var isCheckingOut = false

Button("결제하기") {
    guard !isCheckingOut else { return }
    isCheckingOut = true
    Task {
        defer { isCheckingOut = false }
        let result = await checkout()
        guard result.isSuccess else { return }
        push(.receipt(orderId: result.orderId))
    }
}
.disabled(isCheckingOut)
```

진행 중이면 버튼이 비활성화돼서 두 번째 탭 자체가 안 들어오고 `defer`로 flag 복구까지 같이 묶으니까 실패 흐름에서도 잠긴 채 끝나지 않는다.

## 3. path를 두 곳에서 들고 있음

부모 ViewModel에서 `path`를 들고 있는데 자식 화면이 또 자기 `path: [Route]`를 만들어 push를 시도하면 같은 destination이 두 군데에서 처리돼서 화면이 또 두 번 쌓인다. 잘 안 보이는 경로라 한참 헷갈렸다.

`NavigationStack`의 path는 **진입점 한 곳에서만 소유**한다는 룰을 정해두는 게 안전하다. 자식 화면은 path를 새로 만들지 않고 `@Binding`으로 받아서 같은 배열에 append하거나 라우터 객체 한 개에 모아 그쪽에서만 굴리는 식으로 통일한다.

## 회고

`NavigationStack`을 처음 다룰 때는 머릿속에서 여전히 `pushViewController`가 돌고 있었는데 실제로는 SwiftUI가 `path` 배열을 보고 그대로 그려주는 거라서 같은 값이 두 번 들어가면 같은 화면이 그대로 두 번 그려진다.

사용자 입력은 빠르고 비동기는 늦으니까 그 시간차가 다 중복 push가 나기 좋은 구간이 되는 셈이다. 가능하면 `NavigationLink(value:)`로 선언적 push에 맡기고 코드로 path를 직접 만지는 부분은 dedupe + loading guard를 묶어두는 게 결국 답이었다.
