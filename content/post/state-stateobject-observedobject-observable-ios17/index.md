+++
author = "오깅중"
title = "iOS 17 이후 @StateObject는 거의 안 쓰게 됐다"
slug = "state-stateobject-observedobject-observable-ios17"
date = "2026-05-12T11:00:00+09:00"
description = "iOS 17부터 들어온 @Observable 매크로 덕분에 ViewModel 들고 다닐 때 @StateObject/@ObservedObject 둘 중 뭘 쓸지 헷갈리던 자리가 거의 사라졌다."
categories = ["Swift"]
tags = ["SwiftUI", "Observable", "State", "iOS17"]
image = ""
+++

iOS 17 나오기 전까지 SwiftUI 상태 관리에서 가장 헷갈리는 자리가 `@StateObject`랑 `@ObservedObject` 차이였다. 둘 다 ViewModel 들고 다닐 때 쓰는데 동작이 미묘하게 달라서, 잘못 쓰면 자식 화면 상태가 매번 리셋되는 버그를 만든다. iOS 17부터 [Observation 매크로](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro)(`@Observable`)가 들어오면서 그 구분 자체가 거의 의미 없어졌다.

비교하면 이 정도로 짧아진다.

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

`@Observable` 한 줄 박으면 `@Published` 다 떼고 View 쪽도 `@State`로 바뀐다. App 진입점에서 `environmentObject(_:)` 쓰던 자리도 `environment(_:)`로 옮겨간다.

## 그래도 셋의 차이는 알아두는 게 좋음

새 코드는 위처럼 쓰면 끝인데, iOS 16 이하 끌고 가는 프로젝트나 legacy 손볼 때를 위해서는 차이를 알아둘 필요가 있다.

| | 타입 | 누가 만드나 | 라이프사이클 |
|---|---|---|---|
| `@State` | 값 타입 (또는 iOS 17+ `@Observable` 클래스) | View가 직접 | View와 함께 |
| `@StateObject` | `ObservableObject` 채택 클래스 | View가 직접 | View 처음 init 때 한 번만 생성, 부모가 다시 그려져도 유지 |
| `@ObservedObject` | `ObservableObject` 채택 클래스 | 외부에서 주입 | 부모가 다시 그려지면 새 인스턴스 받을 수 있음 |

가장 자주 나는 사고는 `@StateObject` 자리에 `@ObservedObject`를 쓰는 거다.

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

자식이 직접 만들고 자식이 들고 있어야 할 ViewModel이면 `@StateObject`. 외부에서 받아서 관찰만 하는 거면 `@ObservedObject`. 이 구분이 안 맞으면 자식 화면 상태가 부모 리렌더 때마다 리셋되는데, 처음 보면 진짜 이유를 못 찾는다.

## @Bindable은 어디 쓰나

`@ObservedObject` 시절에는 `$vm.value`로 binding 바로 꺼냈는데, `@Observable` 클래스는 이게 안 된다. binding이 필요한 자리에서 `@Bindable`을 쓴다.

```swift
struct EditView: View {
    @Bindable var counter: Counter
    var body: some View {
        TextField("name", text: $counter.name)
    }
}
```

자식이 외부에서 받은 객체에 binding을 만들어야 할 때만 `@Bindable`이 필요. 그냥 읽기만 하면 일반 프로퍼티로 받아도 SwiftUI가 알아서 변경 추적한다. body가 실제로 읽은 프로퍼티만 추적해서 [성능도 더 좋다](https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro)고 공식 문서에 박혀 있다.

---

써보면서 느낀 건, 17+ 환경 잡고 새 코드 쓰는 거면 `@StateObject`/`@ObservedObject`/`@Published` 묶음을 다시 만질 일이 거의 없다는 거. SwiftUI 처음 배우는 사람한테 "ObservableObject 익히기 전에 `@Observable`부터 보라"고 권하게 됐다. legacy 손볼 일 생기면 그때 위 표 다시 보면 됨.
