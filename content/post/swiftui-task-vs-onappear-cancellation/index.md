+++
author = "오깅중"
title = "SwiftUI .task vs .onAppear, 어느 쪽이 안전한가"
slug = "swiftui-task-vs-onappear-cancellation"
date = "2026-05-26T13:45:00+09:00"
description = "화면이 사라질 때 비동기 작업이 따라서 취소되느냐의 문제. .task와 .onAppear { Task { } }가 같아 보여도 동작이 갈리는 지점을 정리한다."
categories = ["SwiftUI"]
tags = ["SwiftUI", "Task", "Concurrency", "onAppear", "iOS17"]
image = ""
+++

`.task`와 `.onAppear { Task { } }`가 처음엔 둘 다 "뷰가 떴을 때 비동기 작업 시작"으로 보였다. 둘 중 하나만 골라 쓰면 되겠다 싶었는데, 화면을 빠르게 들락거리면서 네트워크 로그를 보다가 두 패턴이 같은 상황에서 전혀 다르게 동작하는 걸 봤다. 차이가 한 줄로 요약된다. **사라진 뷰의 작업을 자동으로 취소해 주느냐 아니냐.**

## 어떤 코드가 문제였나

상세 화면이 뜨면 서버에서 데이터를 받아오고, 뒤로 가기로 나가면 더 이상 그 결과가 필요 없는 흔한 흐름이다. 처음엔 이렇게 짰다.

```swift
struct DetailView: View {
    let id: Int
    @State private var detail: Detail?

    var body: some View {
        content
            .onAppear {
                Task {
                    detail = try? await loader.fetch(id: id)
                }
            }
    }
}
```

화면을 빠르게 열었다 닫았다 반복하면 이미 사라진 뷰의 응답이 뒤늦게 도착한다. 그래도 `@State`가 살아 있다가 다시 들어오면 옛 응답이 화면에 그대로 남아 있거나, 같은 화면을 여러 번 들어가면 그만큼 요청이 동시에 떠다닌다. `onAppear`는 동기 클로저라서 안에서 띄운 `Task`는 뷰 생명주기와 끈이 끊겨 있다.

## `.task`로 바꾸면 달라지는 것

같은 구간을 `.task`로 옮기면 한 가지가 더 붙는다.

```swift
struct DetailView: View {
    let id: Int
    @State private var detail: Detail?

    var body: some View {
        content
            .task {
                detail = try? await loader.fetch(id: id)
            }
    }
}
```

뷰가 나타날 때 `Task`가 시작되고, **뷰가 사라지면 그 `Task`가 자동으로 cancel 된다.** `await` 지점에서 `CancellationError`가 던져지거나 `Task.isCancelled`가 true로 바뀌니까 뒤늦게 도착한 응답이 사라진 뷰의 상태를 건드리는 일이 줄어든다. URLSession을 통한 요청도 Task가 cancel 되면 같이 끊긴다.

## 의존성 따라 다시 시작하고 싶다면

상세 화면의 `id`가 바뀔 때마다 새로 로드하고 싶을 때는 `.task(id:)`를 쓴다.

```swift
.task(id: id) {
    detail = try? await loader.fetch(id: id)
}
```

`id` 값이 바뀌면 이전 `Task`를 cancel 하고 새 `Task`를 시작한다. `onChange(of:)` 안에서 또 `Task`를 띄우는 패턴을 흔히 보는데, 이쪽이 cancel 보장까지 같이 들어와서 race 케이스가 줄어든다.

## `.onAppear`를 그래도 써야 할 때

`.onAppear`가 못 쓰는 도구는 아니다. 동기 부수 효과 — 분석 이벤트 전송 호출, 키보드 포커스 잡기, 로그 한 줄 같은 — 는 여전히 `.onAppear`가 자연스럽다. 비동기 작업을 직접 띄울 일이 아닐 때만 골라 쓰면 된다.

굳이 `.onAppear` 안에서 `Task`를 띄워야 하는 상황이라면 Task 핸들을 직접 잡아두고 `.onDisappear`에서 cancel 해 줘야 한다.

```swift
@State private var loadTask: Task<Void, Never>?

var body: some View {
    content
        .onAppear {
            loadTask = Task {
                detail = try? await loader.fetch(id: id)
            }
        }
        .onDisappear {
            loadTask?.cancel()
        }
}
```

써놓고 보면 `.task` 한 줄이 해주는 일을 손으로 다시 짠 셈이다. 그래서 비동기 로딩은 거의 다 `.task`로 옮겼다.

## 정리

`.task`를 기본값으로 두고, `.onAppear`는 동기 부수 효과 쪽에 남겨둔다. 의존성 따라 다시 시작해야 하면 `.task(id:)`. 긴 `AsyncStream` 구독이나 카메라 프리뷰처럼 화면이 살아 있는 동안만 돌아야 하는 작업은 더더욱 `.task`가 맞다. 같은 구간에 두 줄을 다 써 보면서 네트워크 탭으로 cancel 여부를 한 번 확인해 보면 차이가 바로 보인다.
