+++
author = "오깅중"
title = "NavigationStack path가 커질 때 Route enum으로 버티기"
slug = "navigationstack-route-enum-path"
date = "2026-06-02T07:40:00+09:00"
description = "SwiftUI NavigationStack에서 여러 모델 타입을 path에 직접 넣다가 화면 전환이 흩어진 경험과 Route enum으로 목적지를 모으는 기준을 정리한다."
categories = ["SwiftUI"]
tags = ["SwiftUI", "NavigationStack", "Navigation", "Router", "iOS16"]
image = "thumbnail.png"
+++

`NavigationStack`은 처음 붙이면 꽤 편하다. 리스트에서 값을 누르고, `navigationDestination`만 선언하면 상세 화면으로 넘어간다. 작은 화면에서는 이 정도로 충분하다.

문제는 화면이 늘어난 뒤다. 상품 상세, 리뷰 작성, 설정, 웹뷰, 알림 딥링크가 같은 stack을 타기 시작하면 `path`에 무엇을 넣을지 애매해진다. 어떤 곳은 `Product.ID`, 어떤 곳은 `Product`, 어떤 곳은 문자열 URL을 넣고, destination 선언도 여러 파일에 흩어진다.

나는 이 시점부터 `Route` enum을 둔다. 핵심은 거창한 라우터를 만드는 게 아니라, **화면 이동의 입력값을 한 타입으로 모으는 것**이다.

## 모델을 그대로 path에 넣으면 빨리 시작할 수 있다

가장 단순한 코드는 이렇다.

```swift
struct ProductListView: View {
    let products: [Product]

    var body: some View {
        NavigationStack {
            List(products) { product in
                NavigationLink(value: product) {
                    ProductRow(product: product)
                }
            }
            .navigationDestination(for: Product.self) { product in
                ProductDetailView(product: product)
            }
        }
    }
}
```

Apple 문서의 [`navigationDestination(for:destination:)`](https://developer.apple.com/documentation/swiftui/view/navigationdestination%28for%3Adestination%3A%29)는 특정 데이터 타입에 맞는 destination을 선언한다. 이 방식은 화면 하나짜리 흐름에서는 읽기 쉽다.

그런데 앱이 커지면 모델 타입 자체가 navigation contract가 된다. `Product`가 `Hashable`이어야 하고, 상세 화면에 필요한 값이 바뀔 때 navigation 값도 같이 흔들린다. 원격 알림에서 `productID`만 받은 경우에는 다시 `Product`를 만들어 넣을 수도 없다.

## 화면 이동 값은 모델보다 작게 잡는다

상세 화면에 필요한 최소 입력은 보통 전체 모델이 아니라 식별자다.

```swift
enum AppRoute: Hashable {
    case productDetail(id: Product.ID)
    case reviewEditor(productID: Product.ID)
    case settings
    case webPage(title: String, url: URL)
}
```

이렇게 두면 `NavigationPath`나 `[AppRoute]`에 한 종류의 값만 들어간다.

```swift
struct RootView: View {
    @State private var path: [AppRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            ProductListView { product in
                path.append(.productDetail(id: product.id))
            }
            .navigationDestination(for: AppRoute.self) { route in
                destination(for: route)
            }
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .productDetail(let id):
            ProductDetailView(productID: id)
        case .reviewEditor(let productID):
            ReviewEditorView(productID: productID)
        case .settings:
            SettingsView()
        case .webPage(let title, let url):
            WebPageView(title: title, url: url)
        }
    }
}
```

여기서 `ProductDetailView`는 `productID`를 받고 필요한 데이터를 직접 로드한다. 리스트가 들고 있던 `Product` 인스턴스를 상세 화면까지 끌고 가지 않는다. 데이터 freshness도 이쪽이 낫다.

## Route enum은 화면 이름표가 아니라 입력 계약이다

`Route`를 만들 때 자주 하는 실수는 화면 이름만 넣는 것이다.

```swift
enum AppRoute: Hashable {
    case productDetail
}
```

이러면 상세 화면에 필요한 값은 전역 store나 별도 state에서 찾아야 한다. 결국 navigation과 상태가 다시 분리되어 추적하기 어렵다.

반대로 모델 전체를 넣는 것도 애매하다.

```swift
enum AppRoute: Hashable {
    case productDetail(Product)
}
```

이 방식은 빠르게 만들 수 있지만 path 복원, 딥링크, push 알림 처리에서 불편해진다. 라우트에는 화면을 열기 위한 최소 값만 넣는 편이 오래 간다.

내 기준은 이렇다.

| 라우트 값 | 적합도 |
|---|---|
| 화면 이름만 | 대부분 부족함 |
| 모델 전체 | 작은 예제에서는 편함, 앱이 커지면 무거움 |
| 모델 ID + 화면 옵션 | 가장 무난함 |
| View 자체 | 피하는 편이 좋음 |

## push와 deep link도 같은 Route로 보낸다

`Route` enum을 쓰면 외부 진입도 같은 코드로 모을 수 있다.

```swift
func handlePush(_ payload: PushPayload) {
    guard let productID = payload.productID else { return }
    path.append(.productDetail(id: productID))
}

func handleURL(_ url: URL) {
    guard let route = AppRoute(url: url) else { return }
    path.append(route)
}
```

URL parsing은 extension으로 빼도 된다.

```swift
extension AppRoute {
    init?(url: URL) {
        let components = url.pathComponents

        if components.count == 3, components[1] == "products" {
            self = .productDetail(id: components[2])
            return
        }

        return nil
    }
}
```

여기서 중요한 건 push, deep link, 내부 버튼이 전부 같은 `.productDetail(id:)`로 들어온다는 점이다. 어느 경로로 들어왔는지에 따라 상세 화면 생성 방식이 달라지지 않는다.

## destination은 루트 근처에 모은다

`navigationDestination`을 여러 하위 View에 흩뿌리면 나중에 같은 타입에 대한 destination이 어디서 적용되는지 헷갈린다. 특히 `String`, `UUID` 같은 범용 타입을 destination 값으로 쓰면 더 위험하다.

```swift
.navigationDestination(for: String.self) { value in
    Text(value)
}
```

이 코드는 간단하지만 `String`을 navigation 값으로 쓰는 모든 흐름에 영향을 줄 수 있다. 그래서 앱 단위 navigation에서는 범용 타입보다 도메인 라우트 타입을 선호한다.

```swift
.navigationDestination(for: AppRoute.self) { route in
    destination(for: route)
}
```

하위 View는 화면을 직접 push하지 않고 action을 올린다.

```swift
struct ProductListView: View {
    let onSelect: (Product) -> Void

    var body: some View {
        List(products) { product in
            Button {
                onSelect(product)
            } label: {
                ProductRow(product: product)
            }
        }
    }
}
```

이러면 리스트는 navigation 구조를 몰라도 된다. 재사용도 편하고 preview도 단순해진다.

## path를 전역으로 만들지는 않는다

`Route` enum을 만들었다고 곧바로 전역 Router 객체를 만들 필요는 없다. 탭마다 navigation stack이 다르면 path도 탭마다 따로 있는 게 자연스럽다.

```swift
struct MainTabView: View {
    @State private var homePath: [AppRoute] = []
    @State private var settingsPath: [AppRoute] = []

    var body: some View {
        TabView {
            HomeRoot(path: $homePath)
                .tabItem { Label("홈", systemImage: "house") }

            SettingsRoot(path: $settingsPath)
                .tabItem { Label("설정", systemImage: "gear") }
        }
    }
}
```

외부 진입만 중앙에서 받아 어느 탭의 path에 넣을지 결정하면 된다. 모든 화면 이동을 하나의 singleton router에 몰아넣으면 처음엔 편하지만, 탭별 복원과 테스트가 더 어려워진다.

## 내가 잡은 기준

`NavigationStack`이 커질 때는 이렇게 정리한다.

1. 작은 화면 하나면 모델을 직접 `NavigationLink(value:)`에 넣어도 된다.
2. 외부 진입, 여러 destination, path 조작이 생기면 `Route` enum으로 모은다.
3. 라우트에는 화면을 열기 위한 최소 입력만 넣는다.
4. `String`, `UUID` 같은 범용 타입 destination은 앱 루트에서 피한다.
5. destination 선언은 stack 루트 근처에 둔다.
6. 탭마다 stack이 다르면 path도 분리한다.

`NavigationStack`은 화면 전환을 데이터로 표현하게 해준다. 그래서 그 데이터의 타입을 대충 잡으면 나중에 전환 규칙도 대충 흩어진다. `Route` enum은 추상화라기보다, 화면 이동 값에 이름과 경계를 붙이는 일에 가깝다.
