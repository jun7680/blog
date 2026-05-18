+++
author = "오깅중"
title = "@Entry 매크로로 EnvironmentValues 보일러플레이트 날려버리기"
date = "2026-05-18T08:05:00+09:00"
description = "EnvironmentValues 하나 추가하려고 struct + getter/setter 쓰던 거, @Entry 한 줄로 끝낸다. iOS 13까지 역호환."
categories = ["iOS", "SwiftUI"]
tags = ["SwiftUI", "Swift Macro", "@Entry", "EnvironmentValues", "Xcode 16"]
slug = "swiftui-entry-macro-environmentvalues"
image = ""
+++

SwiftUI로 작업하다 보면 커스텀 `EnvironmentValues`를 만들 일이 종종 생긴다. 그런데 값 하나 추가하려고 `EnvironmentKey` struct 만들고, `defaultValue` 지정하고, `EnvironmentValues` extension에 getter/setter 두 줄까지 — 매번 같은 보일러플레이트를 반복하는 게 솔직히 좀 짜증났다. 그러다 `@Entry` 매크로를 알게 됐는데, "이걸 왜 이제야 줬냐" 싶을 만큼 깔끔하다. 게다가 Xcode 16 이상이면 쓸 수 있고, deployment target은 iOS 13까지 내려간다.

## Before: 기존 EnvironmentKey 방식

예전에는 `iconColor`라는 값 하나 추가하려고 이렇게 썼다.

```swift
private struct IconColorKey: EnvironmentKey {
    static let defaultValue: Color = .red
}

extension EnvironmentValues {
    var iconColor: Color {
        get { self[IconColorKey.self] }
        set { self[IconColorKey.self] = newValue }
    }
}
```

총 9줄. struct 하나, extension 하나, getter/setter 한 쌍. 패턴이 늘 똑같으니까 처음 몇 번은 그러려니 했는데, 값이 늘어날수록 복붙 노가다가 된다.

## After: @Entry 한 줄로 끝

같은 걸 `@Entry`로 바꾸면 이렇게 된다.

```swift
extension EnvironmentValues {
    @Entry var iconColor: Color = .red
}
```

끝. 기본값까지 한 줄 안에 들어간다. 위의 9줄이 정확히 1줄로 줄었다.

매크로가 실제로 어떤 코드를 풀어내는지 궁금하면 Xcode에서 `@Entry`를 우클릭 → **Expand Macro**로 펼쳐 볼 수 있다. 결국은 위의 Before 코드와 동일한 형태로 펼쳐진다. 마법이 아니라 그냥 자동화다.

## 사용부는 그대로

가장 마음에 드는 점은 호출부 코드가 하나도 안 바뀐다는 거다. 값 주입도, 읽는 방식도 평소대로다.

```swift
// 설정
ContentView()
    .environment(\.iconColor, .blue)

// 읽기
struct IconView: View {
    @Environment(\.iconColor) private var iconColor

    var body: some View {
        Image(systemName: "star").foregroundStyle(iconColor)
    }
}
```

덕분에 기존 `EnvironmentKey` 정의를 `@Entry`로 갈아엎어도 사용처는 손댈 필요가 없다. 타입이랑 기본값만 동일하게 옮기면 동작도 동일하다. 마이그레이션 비용이 거의 0에 수렴한다.

## environment 외에도 적용 가능

여기서 더 좋은 소식. `@Entry`는 `EnvironmentValues`만을 위한 매크로가 아니다. `Transaction`, `Container`, `FocusedValues`에도 같은 방식으로 적용된다.

예를 들어 `Transaction`에 커스텀 값을 추가하고 싶으면 이렇게 쓰면 된다.

```swift
extension Transaction {
    @Entry var animationKind: AnimationKind = .default
}
```

`Container`나 `FocusedValues`도 패턴은 동일하다. 한 번 손에 익으면 SwiftUI에서 값을 흘려보내는 거의 모든 곳에서 같은 문법을 쓸 수 있다.

## 환경과 역호환

여기가 좀 헷갈렸던 부분인데, `@Entry`는 Swift 매크로지만 **런타임 제약이 거의 없다**.

- 빌드 도구: **Xcode 16 이상**
- Deployment target: **iOS 13까지** OK

매크로는 컴파일 타임에 풀려서 결국 기존 보일러플레이트 코드로 변환되니까, 실행 시점에는 일반 `EnvironmentKey` 구현체랑 똑같이 동작한다. iOS 17+ 같은 최신 OS에서만 쓸 수 있는 게 아니라, 옛날 OS 지원하는 프로젝트에서도 빌드 도구만 Xcode 16이면 그대로 적용할 수 있다는 뜻이다.

## 마무리

정리하면 이렇다.

- 보일러플레이트 9줄 → 1줄
- 사용부 변경 0
- iOS 13까지 역호환 (Xcode 16만 있으면 됨)
- `EnvironmentValues` 외에 `Transaction`, `Container`, `FocusedValues`까지 동일 문법

지금 프로젝트에 `EnvironmentKey` struct가 흩어져 있다면, 시간 날 때 `@Entry`로 갈아엎는 걸 추천한다. 동일 타입·동일 기본값만 유지하면 거의 무손실로 정리된다. 한 번 해보면 왜 진작 안 썼나 싶다.

## 참고

- [Apple Docs — EnvironmentValues](https://developer.apple.com/documentation/swiftui/environmentvalues)
- [Antoine van der Lee — Entry macro for custom Environment Values](https://www.avanderlee.com/swiftui/entry-macro-custom-environment-values/)
- [Majid Jabrayilov — Introducing Entry macro in SwiftUI](https://swiftwithmajid.com/2024/07/09/introducing-entry-macro-in-swiftui/)
