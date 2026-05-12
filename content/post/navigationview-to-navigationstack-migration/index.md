+++
author = "오깅중"
title = "NavigationView에서 NavigationStack으로 옮긴 메모"
slug = "navigationview-to-navigationstack-migration"
date = "2026-05-12T12:30:00+09:00"
description = "iOS 16에서 deprecated된 NavigationView를 NavigationStack으로 옮기면서 정리한 메모. 값 기반 push, NavigationPath, 시간 잡아먹은 두 자리."
categories = ["Swift"]
tags = ["SwiftUI", "NavigationStack", "Migration"]
image = ""
+++

NavigationView가 iOS 16에서 deprecated된 지 한참 됐는데, 콘솔 경고 한 줄만 무시하면서 끌고 왔다. SwiftData 마이그하면서 어차피 화면들 다시 만질 일 생긴 김에 같이 옮겼다.

단순 치환은 진짜 단순하다.

```swift
NavigationView {
    List {
        NavigationLink(destination: DetailView()) { Text("상세") }
    }
}
```

이거를

```swift
NavigationStack {
    List {
        NavigationLink { DetailView() } label: { Text("상세") }
    }
}
```

이렇게. grep 한 번 돌려서 한꺼번에 바꿀 수 있는 자리. 근데 이렇게만 끝내면 NavigationStack의 진짜 가치는 거의 못 누린다.

## 값 기반 push가 진짜 변화

View를 직접 push하는 게 아니라 값을 path에 넣고, 그 값에 매핑된 View가 뜨는 구조다.

```swift
NavigationStack {
    List {
        NavigationLink("Mint", value: Color.mint)
        NavigationLink("Pink", value: Color.pink)
    }
    .navigationDestination(for: Color.self) { color in
        ColorDetail(color: color)
    }
}
```

NavigationLink는 `Color.mint`라는 값만 들고 있다. 어디로 갈지는 `navigationDestination(for: Color.self)`가 결정. 라우팅과 View가 분리됐다는 게 핵심. (위 예제는 [Apple 공식 문서](https://developer.apple.com/documentation/swiftui/navigationlink) 패턴 거의 그대로다.)

여러 타입을 라우팅하려면 타입별로 modifier를 따로 박는다.

```swift
.navigationDestination(for: Color.self) { ColorDetail(color: $0) }
.navigationDestination(for: Recipe.self) { RecipeDetail(recipe: $0) }
```

## 코드에서 직접 push·pop

`path`를 binding으로 잡으면 된다.

```swift
@State private var path = NavigationPath()

NavigationStack(path: $path) {
    List {
        Button("상세로") { path.append(Color.mint) }
    }
    .navigationDestination(for: Color.self) { ColorDetail(color: $0) }
}
```

자주 쓰는 조작.

```swift
path.append(value)       // push
path.removeLast()        // pop
path.removeAll()         // popToRoot
path = NavigationPath()  // 같은 popToRoot
```

타입이 하나로 정해지면 NavigationPath 대신 그냥 `[Type]` binding을 써도 된다. 요소 타입이 Codable이면 `@SceneStorage`랑 묶어서 상태 복원도 깔끔. NavigationPath 자체에도 `codable` 프로퍼티가 있는데, path에 들어간 모든 값이 Codable이어야 사용 가능하다.

딥링크는 path 한 번 비우고 새로 쌓는다.

```swift
.onOpenURL { url in
    guard let host = URLComponents(url: url, resolvingAgainstBaseURL: true)?.host else { return }
    path = NavigationPath()
    path.append(host)
}
```

`isActive` binding 단계마다 켜던 NavigationView 시절보다 한결 낫다 ㅋㅋ

## 옮기다가 시간 잡아먹은 자리

`navigationDestination`을 `List`나 `LazyVStack` **안쪽**에 박은 게 처음 한 번. 동작이 들쭉날쭉해서 한참 봤는데, 공식 문서에 정확히 적혀 있었다.

> *Do NOT place the navigation destination modifier inside lazy containers like List or LazyVStack...* — [navigationDestination(for:destination:) — Apple Developer](https://developer.apple.com/documentation/swiftui/view/navigationdestination(for:destination:))

lazy container는 자식 view를 필요할 때만 만든다. NavigationStack이 destination을 못 보는 순간이 생기는 거. **항상 lazy container 바깥**에 박는다. 문서 먼저 읽었으면 안 헤맸을 자리.

또 하나는 popToRoot. `path.removeLast(path.count)`로 길게 짰다가 한참 뒤에 `path.removeAll()`이 그냥 있다는 걸 알았다. 시그니처 한 번 봤으면 끝났을 일.

그리고 마이그 마지막에 발견한 거 — `NavigationLink(destination:label:)` 옛날 형태 그대로 둔 화면이 있었는데, 컴파일은 되는데 path 추적에 안 걸린다. 사용자가 탭해서 들어간 화면을 `path.removeLast()`로 못 뺀다. NavigationStack의 path 추적은 [`NavigationLink(value:)` + `navigationDestination(for:)` 짝](https://developer.apple.com/documentation/swiftui/navigationlink/init(_:value:)-810b2)에서만 동작하니까, 마이그할 때 NavigationLink 형태도 다 같이 바꿔야 한다.

화면 단위로 점진 마이그가 되니까 큰 PR 만들 필요는 없었다. 한 화면 옮기고 동작 확인, 다음 화면 옮기고. SwiftData 시리즈 마이그 흐름이랑 같음.
