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

자식이 직접 만들고 자식이 들고 있어야 할 ViewModel이면 `@StateObject`. 외부에서 받아서 보기만 할 거면 `@ObservedObject`. 이게 안 맞으면 부모 리렌더할 때마다 자식 상태가 리셋되는데, 처음 보면 원인 찾기 진짜 빡셈.

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

## 환경 주입도 표기가 바뀐다

ObservableObject 시절엔 `environmentObject(_:)`로 객체를 트리에 흘려보냈다. `@Observable`은 환경 키를 따로 만들지 않고 **타입 그 자체를 키로** 사용한다.

```swift
// iOS 16
ParentView()
    .environmentObject(authStore)  // AuthStore: ObservableObject

struct ChildView: View {
    @EnvironmentObject var authStore: AuthStore
    ...
}

// iOS 17+
ParentView()
    .environment(authStore)        // @Observable class AuthStore

struct ChildView: View {
    @Environment(AuthStore.self) var authStore
    ...
}
```

자식 쪽도 `@EnvironmentObject` → `@Environment(_:)`로 바뀐다. 옛 코드를 들어낼 때 한 묶음으로 같이 바꿔야 함.

## 점진 마이그레이션 패턴

전체를 한 번에 바꿀 수 없는 프로젝트가 더 많다. iOS 16 유지하면서 17에서만 새 매크로를 활용하려면 둘 다 채택하는 식의 패턴을 잠깐 거치게 된다.

```swift
#if canImport(Observation)
import Observation
#endif

@available(iOS 17, *)
@Observable
final class CounterNew {
    var value = 0
}

final class CounterLegacy: ObservableObject {
    @Published var value = 0
}
```

뷰는 분기.

```swift
struct CounterView: View {
    var body: some View {
        if #available(iOS 17, *) {
            CounterViewNew()
        } else {
            CounterViewLegacy()
        }
    }
}
```

타깃 최소 버전이 17로 올라가는 시점에 legacy 분기를 통째로 들어내면 됨. 한 곳을 통째로 다 갈아엎는 PR보다, 화면 단위로 천천히 갈아치우는 게 회귀 위험이 낮다.

## 옮기면서 만난 함정 몇 가지

- **클래스에 `==`/`Equatable`을 직접 구현해 두면 `@Observable`이 의존 추적을 못 하는 경우가 있다.** `@Observable`은 KeyPath 기반으로 의존성을 잡는데, 커스텀 Equatable이 인스턴스 동일성을 망가뜨리면 뷰가 갱신을 놓침. 가능하면 `Equatable` 안 붙이거나, `id` 같은 명시적 비교에만 사용.
- **`@Published` 제거 잊기.** ObservableObject에서 옮길 때 `@Published`만 떼면 되는데, `@Observable`은 모든 stored property를 자동 추적하므로 `@Published`가 남아 있으면 컴파일 오류 또는 경고.
- **`objectWillChange`로 수동 브로드캐스트하던 코드.** `@Observable`에는 같은 API가 없다. 대부분의 케이스에서 어차피 필요 없는데, 강제 갱신이 필요한 자리는 별도 `@State` 토글 변수로 우회.
- **`@StateObject`로 강제로 유지하던 의존성 그래프.** `@Observable`을 `@State`로 받으면 View 생성 시점에 한 번만 만들어진다는 라이프사이클은 유지된다. 다만 init 비용이 큰 객체라면 명시적으로 `static let shared` 같은 싱글톤으로 외부에서 주입하는 방향이 안전.

## SwiftData도 같은 흐름

iOS 17에서 SwiftData가 나오면서 `@Model` 클래스가 자동으로 `@Observable`이 됐다. 즉 SwiftData 모델은 그냥 `@State` / `@Bindable`로 다루면 끝.

```swift
@Model
final class Todo {
    var title: String
    var done: Bool
    init(title: String, done: Bool = false) {
        self.title = title
        self.done = done
    }
}

struct TodoRow: View {
    @Bindable var todo: Todo
    var body: some View {
        TextField("title", text: $todo.title)
        Toggle("done", isOn: $todo.done)
    }
}
```

ObservableObject + Combine + Repository 패턴으로 한참 우회하던 옛 흐름과 비교하면 분량이 절반 이하로 줄어든다.

## 정리

- iOS 17+ 새 코드는 `@Observable` + `@State` + 필요한 자리에 `@Bindable`. 끝.
- 환경 주입은 `environment(_:)` + `@Environment(Type.self)`로 통일.
- iOS 16 유지 프로젝트는 화면 단위 점진 마이그레이션이 안전.
- SwiftData 모델은 자동 `@Observable`이라 별도 표기가 거의 필요 없음.

새 코드 짤 때 `@StateObject`/`@ObservedObject` 표기를 마주치면 일단 `@Observable`로 옮길 수 있나부터 확인하는 게 출발선이 됐다.
