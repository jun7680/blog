+++
author = "오깅중"
title = "NavigationView에서 NavigationStack으로 옮긴 메모"
slug = "navigationview-to-navigationstack-migration"
date = "2026-05-12T12:30:00+09:00"
description = "iOS 16에서 deprecated된 NavigationView를 NavigationStack으로 옮기면서 정리한 메모. 값 기반 push, NavigationPath, 시간 잡아먹은 두 자리."
categories = ["Swift"]
tags = ["SwiftUI", "NavigationStack", "Migration"]
image = "thumbnail.png"
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

## NavigationStack vs NavigationSplitView

iPad/Mac에서 두 컬럼·세 컬럼 레이아웃을 쓰려면 `NavigationSplitView`가 따로 있다. 둘이 별개 컨테이너지만 안쪽 push 흐름은 `NavigationStack`을 다시 쓰는 구조라서 섞어 쓰는 게 자연스럽다.

```swift
NavigationSplitView {
    SidebarView()
} detail: {
    NavigationStack(path: $path) {
        FeedView()
            .navigationDestination(for: Post.self) { PostDetail(post: $0) }
    }
}
```

iPhone에선 NavigationSplitView가 자동으로 `NavigationStack`처럼 동작해서 한 코드로 양쪽 폼팩터를 커버. iPad·Mac 지원 안 하는 앱이라면 NavigationStack만 써도 충분.

## TabView에서 탭마다 path 따로 관리

탭 기반 앱이면 각 탭이 독립적인 navigation 히스토리를 가져야 한다. path도 탭별로 따로.

```swift
@State private var feedPath = NavigationPath()
@State private var profilePath = NavigationPath()

TabView {
    NavigationStack(path: $feedPath) { FeedView() }
        .tabItem { Label("Feed", systemImage: "house") }

    NavigationStack(path: $profilePath) { ProfileView() }
        .tabItem { Label("Profile", systemImage: "person") }
}
```

탭 간 이동 시 안쪽 navigation이 유지되는 기본 UX가 그대로 살아난다. 한 path 공유하면 탭 갈아탈 때 히스토리가 다 사라지니까 주의.

## Router 패턴으로 path 외부화

스택 깊이가 깊어지면 화면마다 path를 binding으로 들고 다니는 게 번거롭다. `@Observable` 클래스 하나에 path를 묶고 환경으로 흘려보내면 어디서든 `router.push(.detail(id))`로 호출 가능.

```swift
@Observable
final class Router {
    var path = NavigationPath()
    func push(_ value: Hashable) { path.append(value) }
    func popToRoot() { path.removeAll() }
}

@main
struct App: App {
    @State private var router = Router()
    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $router.path) {
                RootView()
                    .navigationDestination(for: Post.self) { PostDetail(post: $0) }
            }
            .environment(router)
        }
    }
}

struct DeepView: View {
    @Environment(Router.self) private var router
    var body: some View {
        Button("취소") { router.popToRoot() }
    }
}
```

화면 어디서든 라우팅 가능 + 딥링크/푸시 알림 같은 외부 트리거에서도 같은 인터페이스로 push. 옛 `NavigationView` 시절 `@Binding var isActive`를 화면마다 흘려보내던 패턴이 한 번에 정리됨.

## 정리

- 표면적 치환은 grep으로 끝나지만, **값 기반 push + navigationDestination**까지 가야 NavigationStack의 가치를 누림.
- destination modifier는 lazy container 바깥에. `NavigationLink(destination:label:)` 옛 형태가 남아 있으면 path 추적이 깨짐.
- 폼팩터 분기는 `NavigationSplitView`, 탭은 path 분리, 깊은 트리는 Router 객체로 외부화.

한 화면씩 옮기면서 path 흐름이 깔끔해지는 게 보이는 마이그레이션이라 작업 자체가 꽤 재밌었다.
