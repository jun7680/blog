+++
author = "오깅중"
title = "iOS 26 SwiftUI 네이티브 WebView, 드디어 한 줄이다"
date = "2026-05-18T08:15:00+09:00"
description = "WKWebView를 UIViewRepresentable로 감싸던 시절은 안녕. iOS 26 네이티브 WebView / WebPage를 짧게 정리해본다."
categories = ["iOS", "SwiftUI"]
tags = ["SwiftUI", "WebView", "WebPage", "WebKit", "iOS 26", "WWDC25"]
slug = "swiftui-webview-webpage-ios26"
image = ""
+++

SwiftUI 프로젝트에서 웹 페이지 하나 띄우려고 `UIViewRepresentable`을 새로 짜본 경험, iOS 개발자라면 한 번쯤 있을 것이다. `WKWebView`를 감싸는 의식 같은 코드 말이다. iOS 26부터는 그게 한 줄로 끝난다. 오늘은 새로 등장한 `WebView`와 `WebPage`를 빠르게 정리해본다.

## 예전 방식 복습

iOS 18까지는 SwiftUI에 웹뷰가 따로 없어서 `WKWebView`를 직접 감싸야 했다. 가장 단순한 형태도 이 정도다.

```swift
struct WebViewLegacy: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView { WKWebView() }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        uiView.load(URLRequest(url: url))
    }
}
```

여기까지는 그래도 양반이다. 진행도를 보여주거나 네비게이션 이벤트를 받으려면 `Coordinator`를 만들고 `WKNavigationDelegate`를 구현해야 했다. 페이지 타이틀을 SwiftUI 쪽으로 전달하려면 KVO나 `@Published`까지 동원되곤 했다. 단순히 웹 페이지 하나 띄우는 일치고는 무게가 꽤 됐다.

## iOS 26의 변화

WWDC25에서 SwiftUI 전용 `WebView`가 공개됐다. iOS 26 / Xcode 26 환경에서 `WebKit`만 가져오면 곧바로 쓸 수 있다.

```swift
import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebView(url: URL(string: "https://jun7680.github.io")!)
    }
}
```

`UIViewRepresentable`도, `Coordinator`도 없다. URL 하나만 넘기면 끝이다. 처음 써봤을 때는 코드가 너무 짧아서 뭔가 빠뜨린 줄 알았다.

## WebView vs WebPage

API는 두 갈래로 나뉜다. 골라 쓰는 기준은 단순하다.

- **WebView**: 그냥 URL만 띄우면 되는 경우. 공지 페이지, 약관, 외부 링크 미리보기 같은 자리.
- **WebPage**: 진행도, 타이틀, 리로드, 정지, JS 실행, 네비게이션 제어 같은 상태가 필요한 경우.

`WebPage`는 페이지 상태를 들고 있는 객체라고 보면 된다. SwiftUI의 `@State`로 보관하고, 필요한 값을 바인딩해서 UI를 구성한다.

## WebPage 실전 — 진행도와 타이틀 연동

간단한 인앱 브라우저를 만든다고 가정하면 이런 모양이 된다.

```swift
struct BrowserView: View {
    @State private var page = WebPage()

    var body: some View {
        VStack {
            ProgressView(value: page.estimatedProgress)
            WebView(page)
        }
        .navigationTitle(page.title ?? "")
        .onAppear {
            page.load(URLRequest(url: URL(string: "https://jun7680.github.io")!))
        }
    }
}
```

`estimatedProgress`를 그대로 `ProgressView`에 묶고, `title`을 `navigationTitle`에 연결한다. 예전 같으면 delegate 메서드 두세 개 구현하고, KVO 토큰 챙기고, `@Published` 프로퍼티 만들어 옮겨 담아야 했던 흐름이 SwiftUI 바인딩 한 줄씩으로 정리된다.

## JavaScript 실행

페이지 안에서 JS를 실행하고 결과를 받는 것도 비동기 한 줄이다.

```swift
let result = try await page.callJavaScript("document.title")
```

`async`/`throws` API이니 `Task` 안에서 호출하고 에러 처리만 챙기면 된다. 예전 `evaluateJavaScript(_:completionHandler:)`의 콜백 지옥에 비하면 훨씬 읽기 좋다.

[작가 주: `callJavaScript`의 정확한 반환 타입과 에러 케이스는 Apple 공식 문서를 함께 확인하길 권한다. 본 글의 예시는 시그니처 소개 수준이다.]

## 언제 쓸 수 있나

당연한 이야기지만 iOS 26 한정이다. iOS 18 이하를 타깃으로 잡고 있다면 여전히 `UIViewRepresentable` + `WKWebView` 조합이 필요하다. 점진 마이그레이션이 가능한 프로젝트라면 `if #available(iOS 26, *)`로 새 API와 기존 래퍼를 동시에 두고, deployment target이 올라가는 시점에 정리하는 흐름이 무난해 보인다.

새로 시작하는 프로젝트이고 타깃이 iOS 26 이상이라면, 더는 `WKWebView`를 직접 감싸지 않아도 된다는 점 하나만 기억해도 충분하다.

## 마무리

SwiftUI가 또 한 영역을 흡수했다. 매번 새 OS 시즌마다 직접 다리 놔주던 API가 하나씩 줄어드는 기분이 든다. WebView 같은 흔한 컴포넌트는 특히 반갑다. 보일러플레이트가 빠진 만큼 본질에 더 집중할 수 있으니까.

다음에는 `WebPage`의 네비게이션 제어(`goBack`, `goForward`, `reload`, `stop`)와 커스텀 스킴 핸들링 쪽을 더 파보려 한다.

## 참고

- [Apple Developer — WebKit](https://developer.apple.com/documentation/webkit)
- [WWDC25 — WebKit for SwiftUI (dev.to 정리)](https://dev.to/arshtechpro/wwdc-2025-webkit-for-swiftui-2igc)
