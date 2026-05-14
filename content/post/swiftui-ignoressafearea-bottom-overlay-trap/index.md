+++
author = "오깅중"
title = "`.ignoresSafeArea(.bottom)` 한 줄에 액션 버튼이 통째로 사라졌다"
date = "2026-05-14T16:26:20+09:00"
description = "한 줄짜리 modifier가 자식 전부에 적용되면서 overlay 액션 버튼까지 home indicator 밑으로 끌어내린 사례."
slug = "swiftui-ignoressafearea-bottom-overlay-trap"
categories = [
    "Swift",
    "iOS"
]
tags = [
    "SwiftUI",
    "ignoresSafeArea",
    "safeAreaInset",
    "Layout",
    "SafeArea",
    "Overlay"
]
image = "thumbnail.jpg"
+++

## 도입

새 SwiftUI 화면을 만들고 있었다. 배경색이 화면 최하단(home indicator 영역)까지 깔리게 하고 싶어서 본체 View에 한 줄을 추가했다.

```swift
.ignoresSafeArea(edges: .bottom)
```

ScrollView 위에 액션 버튼을 `.overlay(alignment: .bottom)`으로 띄워둔 화면이었다. 시뮬레이터를 띄워보니 액션 버튼이 home indicator 위까지 그려져 있었다. 탭은 되는데 디자인이 어긋났다.

원인은 그 한 줄이었다.

## `.ignoresSafeArea`는 자식 전부에 적용된다

`.ignoresSafeArea(edges: .bottom)`을 view 본체에 걸면, 그 view 안의 모든 자식이 safe area를 무시한다. 자식이 ScrollView든 그 ScrollView 위에 얹은 overlay든 다 똑같다.

배경을 home indicator까지 깔자고 추가한 한 줄이, 그 영역에 있는 액션 버튼까지 함께 끌어 내린다. 액션 버튼은 home indicator 위에 떠 있어야 하는데, safe area 무시 옵션 때문에 home indicator 밑까지 깔려버린다.

## 해결 1 — 그냥 뺀다

```swift
.background(Color(uiColor: .white))
// .ignoresSafeArea(edges: .bottom)  ← 제거
```

빼면 SwiftUI가 자동으로 safe area 위에 모든 자식을 배치한다. ScrollView 콘텐츠도 safe area 위까지, 액션 버튼도 home indicator 위로 자연스럽게 자리잡는다.

## 해결 2 — 배경에만 modifier 건다

배경색만 home indicator 영역까지 깔고 싶었다면, 본체가 아니라 background 자체에만 거는 게 깔끔하다.

```swift
.background(
    Color(uiColor: .white)
        .ignoresSafeArea(edges: .bottom)
)
```

이러면 배경만 home indicator 밑까지 내려가고 본문 콘텐츠는 safe area 안에 머문다. 의도한 모양이 정확히 나온다.

## 왜 이런 함정에 빠지는가

`.ignoresSafeArea`는 사용 빈도에 비해 영향 범위가 크다. modifier 한 줄이라 가볍게 읽히는데, 사실은 view tree 전체의 layout 규칙을 바꾼다. 코드 리뷰에서도 한 줄이라 그냥 넘어간다.

처음 보는 사람은 "아 배경 깔려는 거구나"로 읽지, "이 view의 모든 자식이 safe area 무시야"로 안 읽는다. 그 인지 차이가 버그를 만든다.

## 더 안전한 패턴 — `.safeAreaInset`

`.safeAreaInset(edge: .bottom)`을 쓰면 SwiftUI가 자동으로 액션 버튼만큼 콘텐츠 영역을 줄여준다.

```swift
ScrollView {
    content
}
.safeAreaInset(edge: .bottom) {
    bottomActionButton  // 자동으로 safe area 위에 위치
}
```

`.overlay`는 콘텐츠가 액션 버튼 아래로 흘러간다. 마지막 콘텐츠 한두 줄이 버튼에 가려진다. `.safeAreaInset`은 콘텐츠를 알아서 inset 시켜준다. 액션 버튼을 화면 최하단에 띄울 거면 이쪽이 사고가 적다.

## 결국 쓴 코드

처음 썼던 코드. `.ignoresSafeArea`를 view 본체에 걸어서 overlay까지 끌어내린 버전.

```swift
ScrollView {
    content
}
.overlay(alignment: .bottom) {
    bottomActionButton
}
.background(Color(uiColor: .white))
.ignoresSafeArea(edges: .bottom) // 자식 전부에 적용된다
```

최종적으로 가져간 모양. 배경만 home indicator 밑까지 내리고 액션 버튼은 `.safeAreaInset`으로 자리 잡게 한 버전.

```swift
ScrollView {
    content
}
.safeAreaInset(edge: .bottom) {
    bottomActionButton
}
.background(
    Color(uiColor: .white)
        .ignoresSafeArea(edges: .bottom) // 배경 자체에만 격리
)
```

`.ignoresSafeArea`를 배경 안쪽으로 가둬두는 게 핵심이다. 본체에 거는 순간 ScrollView도 overlay도 같이 끌려간다.

## 교훈

- `.ignoresSafeArea`는 view tree 전체 layout 규칙을 바꾼다. 한 줄로 보고 넘기지 말 것.
- 배경만 home indicator 영역까지 깔고 싶으면 배경 자체에만 걸어라. 본체에 걸면 자식 전부가 영향받는다.
- 액션 버튼을 화면 최하단에 띄울 땐 `.overlay`보다 `.safeAreaInset(edge: .bottom)`이 안전하다. 콘텐츠 inset까지 자동이다.
- SwiftUI modifier 한 줄이 가벼워 보여도 영향 범위는 따로 확인해야 한다. 한 줄짜리 정책이 화면 전체를 망치는 경우가 의외로 흔하다.
