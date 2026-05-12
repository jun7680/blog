+++
author = "오깅중"
title = "iOS 17 이후 @StateObject는 거의 안 쓰게 됐다"
slug = "state-stateobject-observedobject-observable-ios17"
date = "2026-05-12T11:00:00+09:00"
description = "iOS 17부터 @Observable 매크로 들어오면서 @StateObject/@ObservedObject 중에 뭘 쓸지 헷갈리던 게 거의 사라졌다."
categories = ["Swift"]
tags = ["SwiftUI", "Observable", "State", "iOS17"]
image = ""
+++

iOS 17 이전에는 SwiftUI 상태 관리할 때 `@StateObject`랑 `@ObservedObject` 중에 뭘 써야 하는지가 진짜 헷갈렸다. 둘 다 ViewModel 들고 다닐 때 쓰는데 동작이 미묘하게 달라서, 잘못 쓰면 자식 화면이 부모 리렌더할 때마다 상태 리셋된다. 17부터 [Observation 매크로](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro)(`@Observable`) 들어오면서 이 고민 자체가 그냥 없어짐.

코드로 보면 이렇게 짧아진다.

```swift
// iOS 16 이전
final class Counter: ObservableObject {
    @Published var value = 0
}

struct CounterView: View {
    @StateObject private var counter = Counter()
    var body: some View { Text("\(counter.value)") }
}
```

```swift
// iOS 17+
@Observable
final class Counter {
    var value = 0
}

struct CounterView: View {
    @State private var counter = Counter()
    var body: some View { Text("\(counter.value)") }
}
```

`@Observable` 한 줄만 붙이면 `@Published` 다 떼도 되고, View 쪽도 그냥 `@State`로 바꾸면 끝. App 진입점도 `environmentObject(_:)` → `environment(_:)`로 옮기면 됨.

## 셋 차이는 그래도 알아두자

새 코드는 위처럼 쓰면 되는데, iOS 16 끌고 가는 프로젝트나 옛날 코드 손볼 일 있으면 차이는 알아둬야 함.

| | 타입 | 누가 만드나 | 라이프사이클 |
|---|---|---|---|
| `@State` | 값 타입 (또는 iOS 17+ `@Observable` 클래스) | View가 직접 | View와 함께 |
| `@StateObject` | `ObservableObject` 채택 클래스 | View가 직접 | 처음 init 때 한 번 생성, 부모 리렌더돼도 유지 |
| `@ObservedObject` | `ObservableObject` 채택 클래스 | 외부에서 주입 | 부모 리렌더되면 새 인스턴스 받을 수 있음 |

가장 자주 헷갈리는 게 `@StateObject` 써야 할 자리에 `@ObservedObject` 쓰는 거.

```swift
// ❌ 부모 리렌더 때마다 ChildViewModel 새로 만들어짐
struct ParentView: View {
    var body: some View {
        ChildView(vm: ChildViewModel())
    }
}

struct ChildView: View {
    @ObservedObject var vm: ChildViewModel
    ...
}
```

자식이 직접 만들고 자식이 들고 있어야 할 ViewModel이면 `@StateObject`. 외부에서 받아서 보기만 할 거면 `@ObservedObject`. 이게 안 맞으면 부모 리렌더할 때마다 자식 상태가 리셋되는데, 처음 보면 원인 찾기 한참 걸린다.

## @Bindable은 어디 쓰나

`@ObservedObject` 시절에는 `$vm.value`로 binding 바로 꺼냈는데, `@Observable` 클래스는 그게 안 됨. binding 필요한 자리에 `@Bindable`을 붙여주면 된다.

```swift
struct EditView: View {
    @Bindable var counter: Counter
    var body: some View {
        TextField("name", text: $counter.name)
    }
}
```

자식이 외부에서 받은 객체에 binding 만들어야 할 때만 `@Bindable`. 그냥 읽기만 할 거면 일반 프로퍼티로 받아도 SwiftUI가 알아서 변경 추적함. body가 실제로 읽은 프로퍼티만 추적해서 [성능도 더 좋다고](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro) 공식 문서에 적혀 있다.

---

사실 17+ 깔리면 이 셋 다시 볼 일이 거의 없음. SwiftUI 처음 배우는 사람한테는 ObservableObject 익히기 전에 `@Observable`부터 보라고 하게 됨. 옛날 코드 만질 일 생기면 그때 표 다시 보면 되고.
