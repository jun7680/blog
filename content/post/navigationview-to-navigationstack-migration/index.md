+++
author = "오깅중"
title = "NavigationView에서 NavigationStack으로 — iOS 16 마이그레이션 정리"
slug = "navigationview-to-navigationstack-migration"
date = "2026-05-12T12:30:00+09:00"
description = "NavigationView가 iOS 16에서 deprecated 됐다. NavigationStack으로 1:1 치환부터 NavigationPath로 프로그래매틱 제어, 딥링크, 자주 걸리는 자리까지 짧게 정리."
categories = ["Swift"]
tags = ["SwiftUI", "NavigationStack", "NavigationView", "iOS16", "Migration", "Navigation"]
image = ""
+++

> **TL;DR** — `NavigationView`는 iOS 16에서 deprecated. 단순 치환은 `NavigationView { ... }` → `NavigationStack { ... }`이지만, 진짜 가치는 `NavigationLink(value:) + navigationDestination(for:)` + `NavigationPath`로 **데이터 기반 navigation**이 가능해진다는 것. 딥링크·프로그래매틱 push/pop이 한결 자연스럽다. 마이그레이션 1:1 치환부터 자주 걸리는 자리 4가지까지 짧게 정리.

---

## 시작하며

Xcode 콘솔에 NavigationView가 iOS 16에서 deprecated 됐다는 경고가 한 번씩 떠 있다. 한참 무시하다가... 새 화면 추가할 때마다 push 동작이 살짝씩 어긋나는 자리가 보여서 결국 마이그레이션 들어갔다.

문서 읽으면서 정리한 걸 쓴다. 깊은 회고 아니고 **체크리스트성 가이드**.

> 공식 마이그레이션 문서: [Migrating to new navigation types — Apple Developer](https://developer.apple.com/documentation/swiftui/migrating-to-new-navigation-types)

---

## 1:1 치환 — 가장 단순한 형태

기존 코드:

```swift
NavigationView {
    List {
        NavigationLink(destination: DetailView()) {
            Text("상세 보기")
        }
    }
}
```

마이그레이션:

```swift
NavigationStack {
    List {
        NavigationLink {
            DetailView()
        } label: {
            Text("상세 보기")
        }
    }
}
```

이 정도는 단순 치환. 프로젝트에 `grep "NavigationView"` 한 번 돌리면 자리가 다 잡힌다.

근데 이거만 바꾸면 NavigationStack의 진짜 가치는 거의 못 누린다. 핵심은 다음 단계.

---

## 값 기반 Navigation — `NavigationLink(value:) + navigationDestination(for:)`

`NavigationStack`이 들고 온 새 패턴. View를 직접 push하는 대신 **값**을 push하고, View는 `navigationDestination` modifier가 매핑한다.

```swift
NavigationStack {
    List {
        NavigationLink("Mint", value: Color.mint)
        NavigationLink("Pink", value: Color.pink)
        NavigationLink("Teal", value: Color.teal)
    }
    .navigationDestination(for: Color.self) { color in
        ColorDetail(color: color)
    }
    .navigationTitle("Colors")
}
```

(출처: [NavigationLink — Apple Developer](https://developer.apple.com/documentation/swiftui/navigationlink))

뭐가 바뀌었나:

- `NavigationLink`는 어떤 View로 갈지 모른다. 값(`Color.mint`)만 넘긴다.
- `navigationDestination(for: Color.self)`가 **타입 단위**로 destination을 매핑.
- View와 라우팅 결정이 분리된다. 같은 라우팅 로직을 여러 자리에서 재사용 가능.

여러 타입도 같은 NavigationStack 안에서 함께 라우팅된다.

```swift
NavigationStack {
    List {
        NavigationLink("Mint", value: Color.mint)
        NavigationLink("Apple Pie", value: Recipe.applePie)
    }
    .navigationDestination(for: Color.self) { color in
        ColorDetail(color: color)
    }
    .navigationDestination(for: Recipe.self) { recipe in
        RecipeDetailView(recipe: recipe)
    }
}
```

각 타입마다 `navigationDestination`을 따로 박는다. SwiftUI가 push된 값의 타입을 보고 적절한 destination을 선택한다.

---

## NavigationPath — 프로그래매틱 제어

지금까지는 사용자가 NavigationLink를 탭해야 push가 일어났다. 코드에서 직접 push/pop하려면 `NavigationPath`를 binding으로 잡는다.

```swift
@State private var path = NavigationPath()

var body: some View {
    NavigationStack(path: $path) {
        List {
            Button("상세로 이동") {
                path.append(Color.mint)
            }
        }
        .navigationDestination(for: Color.self) { color in
            ColorDetail(color: color)
        }
    }
}
```

조작 API:

```swift
path.append(Color.mint)         // push
path.removeLast()                // pop
path.removeLast(path.count)      // popToRoot
path = NavigationPath()          // popToRoot (같은 효과)
```

타입이 하나로 정해진다면 `NavigationPath` 대신 **typed array**를 써도 된다.

```swift
@State private var path: [String] = []

NavigationStack(path: $path) {
    List {
        NavigationLink("First", value: "first")
        NavigationLink("Second", value: "second")
    }
    .navigationDestination(for: String.self) { value in
        DetailView(value: value)
    }
}
```

(공식 예제는 [Migrating to new navigation types](https://developer.apple.com/documentation/swiftui/migrating-to-new-navigation-types) 참고. 거기선 `[Color]`로 예시.)

요소 타입이 `Codable`을 만족하면 `@SceneStorage`/`@AppStorage`와 묶어서 앱 재시작 시 상태 복원도 가능하다. `NavigationPath` 자체도 `codable` 프로퍼티(`NavigationPath.CodableRepresentation`)가 있는데, **path에 들어간 모든 값의 타입이 `Codable`을 만족해야** 사용할 수 있다.

---

## 딥링크 — `onOpenURL` + path 조립

URL 스킴/Universal Link 진입 시 `path`를 직접 조립하면 deep navigation이 한 번에 들어간다.

```swift
@State private var path = NavigationPath()

var body: some View {
    NavigationStack(path: $path) {
        RootView()
            .navigationDestination(for: String.self) { screen in
                ScreenView(name: screen)
            }
    }
    .onOpenURL { url in
        guard let host = URLComponents(url: url, resolvingAgainstBaseURL: true)?.host else { return }
        path = NavigationPath()
        path.append(host)
    }
}
```

`NavigationView` 시절엔 `isActive` binding을 단계마다 켜는 식이었는데... 그건 진짜 다시 안 보고 싶다 ㅋㅋ `path` 한 줄이면 끝.

---

## 자주 걸리는 자리 4가지

### 1. `navigationDestination`을 lazy container 안에 박음

공식 문서가 가장 강하게 경고하는 자리. `List`, `LazyVStack`, `LazyHStack` 같은 **lazy container 내부에 `navigationDestination`을 두면 안 된다.** 자식 view가 필요할 때만 생성되기 때문에, NavigationStack이 destination을 못 보는 순간이 생긴다.

```swift
// ❌ 동작 불안정
NavigationStack {
    List {
        NavigationLink("Detail", value: "x")
        // List 안에 navigationDestination 두지 말 것
    }
    .navigationDestination(for: String.self) { ... }   // ✅ List 바깥
}
```

> *Do NOT place the navigation destination modifier inside lazy containers like List or LazyVStack, as these create child views only when needed. Add the modifier outside these containers so the navigation stack can always see the destination.* — [navigationDestination(for:destination:) — Apple Developer](https://developer.apple.com/documentation/swiftui/view/navigationdestination(for:destination:))

또 `navigationDestination`은 **NavigationStack 안쪽 view의 modifier 체인**에 붙여야 한다. NavigationStack 자체에 붙이면 동작하지 않는다.

### 2. 같은 타입에 destination 여러 번

같은 데이터 타입에 `navigationDestination`을 두 번 이상 등록하면 어느 것이 적용될지 보장이 없다. SwiftUI 공식 문서는 "여러 타입을 다루려면 modifier를 여러 개 두라"고만 안내하지, 같은 타입 중복 시 동작은 명시하지 않는다. **타입당 한 자리**에 라우팅 로직을 모아두는 편이 안전하다.

```swift
// ❌ 동작 보장 안 됨
.navigationDestination(for: Item.self) { ItemDetail($0) }
.navigationDestination(for: Item.self) { OtherView($0) }
```

### 3. `popToRoot`은 옵션이 여러 개

NavigationPath가 들고 있는 stack을 한 번에 비우는 방법이 세 가지. 다 같은 결과지만 의도에 맞는 걸 골라 쓰자.

```swift
// 1) 명시적으로 끝까지 pop — 의도가 가장 명확
path.removeLast(path.count)

// 2) 통째로 새 인스턴스 — 코드 짧음
path = NavigationPath()

// 3) removeAll() — 가장 간단
path.removeAll()
```

처음엔 `path.removeAll()`이 없는 줄 알고 `removeLast(path.count)`로 갔는데, 공식 시그니처 다시 보니 `mutating func removeAll(keepingCapacity: Bool = false)`가 있었다 ㅋㅋ 가장 짧은 게 가장 자연스럽다.

### 4. `NavigationLink(destination:label:)`을 NavigationStack 안에서 그대로 씀

NavigationStack의 `path` 기반 추적은 **`NavigationLink(value:)` + `navigationDestination(for:)` 짝**에서만 동작한다. 이전 형태(`NavigationLink(destination: SomeView())`)는 컴파일은 되지만 path에 안 들어간다. 즉 사용자가 탭해서 들어간 화면을 `path.removeLast()` 같은 프로그래매틱 pop으로 빼낼 수 없다.

> *When a user activates the navigation link created by this initializer, SwiftUI searches for a nearby `navigationDestination(for:destination:)` view modifier...* — [NavigationLink init(_:value:) — Apple Developer](https://developer.apple.com/documentation/swiftui/navigationlink/init(_:value:)-810b2)

마이그레이션 할 때 **모든 NavigationLink를 `value:` 형태로 바꾸는 것**까지 묶어서 가야 path 일관성이 유지된다.

---

## 마이그레이션 체크리스트

- [ ] 프로젝트에서 `NavigationView` grep, 사용처 모두 식별
- [ ] `NavigationView { }` → `NavigationStack { }` 1:1 치환
- [ ] `NavigationLink(destination:label:)` → `NavigationLink(value:)` + `navigationDestination(for:)` 전환
- [ ] `navigationDestination`을 NavigationStack 안쪽 view에 붙이고, **List/LazyVStack 같은 lazy container 내부에는 두지 말기**
- [ ] 같은 타입에 destination 중복 정의 없는지 확인 (타입당 한 자리)
- [ ] popToRoot 동작 검증 (`path.removeAll()` 또는 `path = NavigationPath()`)
- [ ] 딥링크 진입점에서 path 갱신 흐름 점검
- [ ] 상태 복원 필요하면 `[Type]` 또는 `Codable` 요소 사용

---

## 마무리

NavigationView 시절엔 화면 두세 단계만 들어가면 `isActive` bindings이 엉키기 시작했다. NavigationStack은 **path 한 곳**에서 모든 navigation 상태를 본다. 코드에서 push/pop을 직접 굴리는 자리(딥링크, 로그인 후 자동 진입, 알림 탭 진입 등)가 한 결로 정리됨.

다만 1:1 치환만 하고 끝내면 새 패턴의 가치를 거의 못 받는다. **`NavigationLink(value:)` + `navigationDestination(for:)` + `NavigationPath`** 세 가지를 같이 가져가야 NavigationStack을 제대로 쓰는 것. 작은 프로젝트면 한 PR로 끝나고, 큰 프로젝트면 화면 단위로 점진 마이그가 가능하니 부담 적은 작업이다.

> 참고 문서
> - [NavigationStack | Apple Developer](https://developer.apple.com/documentation/swiftui/navigationstack)
> - [NavigationLink | Apple Developer](https://developer.apple.com/documentation/swiftui/navigationlink)
> - [Migrating to new navigation types | Apple Developer](https://developer.apple.com/documentation/swiftui/migrating-to-new-navigation-types)
> - [Understanding the Navigation Stack | Apple Developer](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack)
