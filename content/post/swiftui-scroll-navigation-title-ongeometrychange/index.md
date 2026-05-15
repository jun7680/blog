+++
author = "오깅중"
title = "SwiftUI에서 PreferenceKey가 안 먹어서 onGeometryChange로 갈아탄 디버깅"
slug = "swiftui-scroll-navigation-title-ongeometrychange"
date = "2026-05-15T09:50:00+09:00"
description = "SwiftUI ScrollView에서 스크롤 위치에 따라 네비게이션 타이틀을 점진적으로 노출하려는데 PreferenceKey/GeometryReader 측정값이 갱신되지 않았다. onGeometryChange로 갈아탄 디버깅 회고."
categories = ["Swift"]
tags = ["SwiftUI", "ScrollView", "onGeometryChange", "onScrollGeometryChange", "PreferenceKey", "GeometryReader", "iOS 17"]
+++

SwiftUI 화면에서 본문 헤더가 스크롤로 가려질 때 같은 제목을 네비게이션 중앙 타이틀로 자연스럽게 띄우고 싶었다. 단순한 토글이 아니라 **헤더가 가려지는 정도에 비례해서 opacity가 점점 진해지는** 동작이 필요했다. 별것 아닌 줄 알았는데... 한참 헤맸다.

## 배경

`DocumentDetailView`라는 노트 상세 화면이 있고, 본문 상단에 큼지막한 제목 헤더가 있다. 요구사항은 이렇다.

```text
헤더 안 가려짐      -> 네비게이션 타이틀 opacity 0
헤더 절반 가려짐    -> 네비게이션 타이틀 opacity 0.5
헤더 완전히 가려짐  -> 네비게이션 타이틀 opacity 1
```

## 첫 접근 — GeometryReader + PreferenceKey

SwiftUI에서 흔히 쓰는 방식대로 `GeometryReader`와 `PreferenceKey` 조합으로 시작했다. 본문 헤더의 위치를 ScrollView named coordinate space 기준으로 측정하고, 헤더가 위로 사라지는 정도를 부모 뷰에 전달하는 방식.

```swift
Text(display.title)
    .background(
        GeometryReader { geo in
            Color.clear.preference(
                key: TitleVisibilityPreferenceKey.self,
                value: geo.frame(in: .named(scrollCoordinateSpace)).maxY < 0
            )
        }
    )
```

근데 이건 boolean 전환만 가능해서 "가려지는 정도에 따른 점진 노출"에는 안 맞았다. 그래서 다음 단계로 스크롤 오프셋과 헤더 높이를 직접 계산해서 opacity를 만들었다.

```swift
opacity = scrollOffsetY / headerHeight
```

## 증상

View Hierarchy를 열어보면 네비게이션 중앙에 `Text - 노트 A` 같은 식으로 텍스트가 실제로 존재했다. 레이아웃 자리도 잡혀 있었다.

즉 문제는 다음이 아니었다.

- 데이터가 없는 문제 아님
- 네비게이션 중앙 뷰가 생성되지 않은 문제 아님
- 텍스트가 잘못 바인딩된 문제 아님

텍스트는 존재하는데 화면에서만 안 보이는 상태. 이건 SwiftUI에서 텍스트의 `opacity`가 0이거나 색상 alpha가 0일 때 나오는 증상이다.

## 로그로 원인 좁히기

추측으로 계속 고치면 안 되는 상황이라, 먼저 값 흐름을 확인하는 로그를 깔았다.

```swift
print(
    """
    [DocumentDetailView] navTitleTrace \
    source=\(source), \
    title=\(store.state.display?.title ?? .empty), \
    offsetY=\(offsetY), \
    headerHeight=\(headerHeight), \
    opacity=\(opacity)
    """
)
```

처음 `PreferenceKey` 기반 로그는 앱 진입 시 한 번만 찍히고, 스크롤 중에는 찍히지 않았다.

이 시점에 확인된 사실은 다음.

```text
PreferenceKey/GeometryReader 기반 위치 측정이 스크롤 중 갱신되지 않음
```

원인 분리를 위해 임시로 `UIScrollView.contentOffset`을 KVO로 관찰했다. 이 코드는 최종 구현에 남기지 않았고, 순수하게 디버깅 목적이었다.

결과적으로 스크롤 오프셋은 정상적으로 변하고 있었다.

```text
[DocumentDetailView] navTitleTrace source=contentOffset, title=노트 A, offsetY=83.6, headerHeight=0.0, opacity=0.0
[DocumentDetailView] navTitleTrace source=contentOffset, title=노트 A, offsetY=83.0, headerHeight=0.0, opacity=0.0
[DocumentDetailView] navTitleTrace source=contentOffset, title=노트 A, offsetY=82.3, headerHeight=0.0, opacity=0.0
```

여기서 원인이 더 좁혀졌다.

```text
contentOffset은 정상
headerHeight가 계속 0
따라서 opacity도 계속 0
```

즉 최종 원인은 스크롤 추적 자체가 아니라, **헤더 높이 측정값이 유효하게 들어오지 않는 것**이었다.

## UIKit 브리지를 최종 구현에서 제외

임시로 `UIScrollView.contentOffset` KVO를 붙였을 때 스크롤 값은 정확하게 들어왔다. 하지만 이 화면은 SwiftUI 전환 중인 화면이고, UIKit 의존성을 줄이는 방향이 더 맞다.

`UIViewRepresentable`로 내부 `UIScrollView`를 찾아 KVO를 거는 방식엔 이런 문제가 있다.

- SwiftUI 내부 구현 구조에 의존함
- UIKit 의존성이 화면 코드에 다시 생김
- 나중에 SwiftUI ScrollView 구현이 바뀌면 깨질 수 있음
- 화면 전환 목표인 SwiftUI + MVI 구조와 맞지 않음

그래서 KVO 브리지는 원인 확인용으로만 쓰고 제거했다.

## 공식 API 확인

Apple 문서를 다시 보니 SwiftUI에는 스크롤/geometry 변화 관찰용 API가 이미 있다.

- `onScrollGeometryChange`: ScrollView의 `ScrollGeometry` 변화를 관찰 (iOS 18+)
- `ScrollGeometry.contentOffset`: ScrollView content offset 제공
- `onGeometryChange`: 일반 View의 geometry 변화를 관찰 (iOS 16+)

참고 문서:

- [Apple — ScrollGeometry](https://developer.apple.com/documentation/swiftui/scrollgeometry)
- [Apple — SwiftUI Scroll views](https://developer.apple.com/documentation/swiftui/scroll-views)
- [Apple — onGeometryChange](https://developer.apple.com/documentation/swiftui/view/ongeometrychange(for:of:action:))

이 프로젝트의 최소 iOS 타깃은 17.0이라 `onScrollGeometryChange`(iOS 18+)는 못 써도, `onGeometryChange`(iOS 16+)는 쓸 수 있다. UIKit 브리지 대신 이걸로 충분히 풀린다.

## 최종 해결 — onGeometryChange 기반 순수 SwiftUI

최종 구현은 두 값을 분리해서 추적한다.

- `scrollOffsetY`: ScrollView 상단 sentinel의 위치 변화로 계산
- `headerHeight`: 헤더 뷰 자신의 실제 높이로 계산

### 스크롤 오프셋 추적

ScrollView content 최상단에 0pt 높이의 sentinel을 둔다. 이 sentinel의 `minY`가 스크롤에 따라 음수로 이동하므로, `-minY`를 offset으로 쓴다.

```swift
private var scrollOffsetSentinel: some View {
    Color.clear
        .frame(height: 0)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.frame(in: .named(scrollCoordinateSpace)).minY
        } action: { minY in
            scrollOffsetY = max(-minY, 0)
        }
}
```

### 헤더 높이 추적

헤더 뷰에는 `onGeometryChange`를 직접 붙여 실제 높이를 읽는다.

```swift
.onGeometryChange(for: CGFloat.self) { proxy in
    proxy.size.height
} action: { height in
    guard height > 0 else { return }
    headerHeight = height
}
```

### opacity 계산

이제 opacity는 단순해진다.

```swift
private var navigationTitleOpacity: CGFloat {
    guard headerHeight > 0 else { return 0 }
    return min(max(scrollOffsetY / headerHeight, 0), 1)
}
```

스크롤 오프셋이 헤더 높이만큼 이동하면 opacity는 1이 된다.

## 네비게이션 타이틀 렌더링

처음에는 `UIColor.withAlphaComponent(...)`로 타이틀 색상 alpha를 바꾸려고 했다.

```swift
UIColor.label.withAlphaComponent(navigationTitleOpacity)
```

근데 디버깅 과정에서 View Hierarchy에는 텍스트가 있는데 화면에 안 보이는 상황이 있었기 때문에, 색상 alpha 경로보다 SwiftUI `Text.opacity(...)`를 직접 쓰는 쪽으로 바꿨다.

공용 `NavigationTitleConfig`에 `titleOpacity`를 추가하고, 실제 SwiftUI Text에 적용했다.

```swift
Text(center.title.text)
    .font(.medium18)
    .foregroundColor(Color(uiColor: center.title.color))
    .opacity(center.titleOpacity)
```

이렇게 하면 데이터/색상/투명도 역할이 분리된다.

- 텍스트 내용: `center.title.text`
- 기본 색상: `center.title.color`
- 스크롤 연동 노출 정도: `center.titleOpacity`

## 본문 헤더는 반대로 fade-out

네비게이션 타이틀이 점점 나타나면, 본문 헤더는 같은 속도로 흐려지게 만들 수 있다. `navigationTitleOpacity`가 `0 -> 1`로 증가하니, 본문 헤더는 그 반대값을 쓰면 된다.

```swift
private var documentHeaderOpacity: CGFloat {
    return 1 - navigationTitleOpacity
}
```

이 값을 본문 헤더에 적용한다.

```swift
.opacity(documentHeaderOpacity)
```

주의할 점은 배경까지 같이 투명하게 만들지 않는 것. 배경이 같이 흐려지면 아래 색상이나 구분선이 비쳐서 의도와 다르게 보일 수 있다. 그래서 흰 배경은 유지하고, 헤더 텍스트 영역만 흐려지도록 modifier 순서를 조정했다.

## 최종 로그

정상 동작 시 로그는 이렇게 나와야 한다.

```text
[DocumentDetailView] navTitleTrace source=headerGeometry, title=노트 A, offsetY=0.0, headerHeight=56.0, opacity=0.0
[DocumentDetailView] navTitleTrace source=scrollSentinel, title=노트 A, offsetY=28.0, headerHeight=56.0, opacity=0.5
[DocumentDetailView] navTitleTrace source=scrollSentinel, title=노트 A, offsetY=56.0, headerHeight=56.0, opacity=1.0
```

## 결론

이번 문제의 핵심은 "네비게이션 타이틀이 안 보인다"가 아니었다. 실제 문제는 다음 흐름.

```text
Text는 존재함
하지만 opacity가 0
opacity가 0인 이유는 headerHeight가 0
headerHeight가 0인 이유는 PreferenceKey/GeometryReader 기반 측정값이 이 화면 구조에서 유효하게 갱신되지 않음
```

최종 해결은 SwiftUI의 `onGeometryChange`로 스크롤 sentinel과 헤더 높이를 직접 추적하는 방식이었다.

이번 디버깅에서 얻은 교훈은 명확하다.

- View Hierarchy에 Text가 보이면 데이터/레이아웃 문제부터 의심하면 안 됨
- "안 보임"은 색상/opacity/rendering 문제일 가능성이 큼
- 스크롤 연동 UI는 offset, 기준 높이, 최종 opacity를 각각 로그로 분리해야 함
- UIKit 브리지는 원인 확인용으로는 쓸 수 있지만, SwiftUI 화면의 최종 구현에 남길지는 별도로 판단해야 함
- 최신 SwiftUI에서는 `PreferenceKey` 대신 `onGeometryChange`/`onScrollGeometryChange`를 먼저 검토할 만함
