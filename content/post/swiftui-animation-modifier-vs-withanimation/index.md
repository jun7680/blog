+++
author = "오깅중"
title = "withAnimation, .animation, .transition 헷갈릴 때 보는 메모"
slug = "swiftui-animation-modifier-vs-withanimation"
date = "2026-05-12T12:30:00+09:00"
description = "SwiftUI에서 상태 변화에 애니메이션 붙이려고 할 때 withAnimation, .animation modifier, .transition 셋이 어떻게 다른지. 그리고 .transition이 안 먹히는 흔한 케이스."
categories = ["Swift"]
tags = ["SwiftUI", "Animation", "Transition", "matchedGeometryEffect"]
image = ""
+++

SwiftUI 애니메이션 처음 만지면 `withAnimation`이랑 `.animation` modifier 둘 중에 뭘 써야 하는지가 가장 헷갈린다. 한 번 잡아두면 다 비슷한 구조라 편한데, 그 전까지는 적용했는데 애니메이션이 안 먹히는 케이스가 자꾸 나옴.

## withAnimation — 상태 변화 자체를 감싸는 것

가장 자주 쓰는 패턴. 상태 토글을 클로저로 감싸면, 그 상태에 영향받는 모든 view가 애니메이션을 탄다.

```swift
@State private var isExpanded = false

var body: some View {
    VStack {
        if isExpanded {
            DetailView()
        }
        Button("Toggle") {
            withAnimation(.easeInOut(duration: 0.3)) {
                isExpanded.toggle()
            }
        }
    }
}
```

`withAnimation` 안에서 일어난 상태 변화가 만드는 모든 view 변경(레이아웃, opacity, frame 등)이 자동으로 0.3초 ease-in-out으로 부드럽게 바뀐다. 별도 modifier 안 붙여도 됨.

## .animation modifier — 특정 view의 변화만 애니메이션

iOS 15부터 `.animation(_:value:)` 형태가 권장. 두 번째 파라미터가 핵심.

```swift
@State private var isHighlighted = false

Rectangle()
    .fill(isHighlighted ? Color.red : Color.blue)
    .frame(width: 100, height: 100)
    .animation(.spring(duration: 0.5, bounce: 0.3), value: isHighlighted)
```

`value:`에 명시한 상태가 바뀔 때만 이 view가 애니메이션을 탄다. `withAnimation` 안 써도 됨. **"이 view는 이 값 변화에만 반응한다"**고 명시하는 패턴이라 의도가 더 분명함.

iOS 14 이전에는 `.animation(.spring())`처럼 단일 인자였는데, 이건 deprecated. 어떤 상태 변화에 반응할지 모호해서 의도하지 않은 곳에서 애니메이션이 튀는 문제가 있었다.

### 둘 중 어느 걸?

- 한 상태 변화로 **여러 view가 같이 움직여야 하면** `withAnimation` 한 번으로 묶기
- **특정 view만** 특정 값에 반응해서 움직이면 `.animation(_:value:)`
- 둘 다 같이 쓰면 `.animation`이 우선

## .transition — 나타나거나 사라질 때

조건부로 등장/소멸하는 view에 진입·퇴장 애니메이션을 붙이는 것. 가장 흔한 실수가 **withAnimation 없이 transition만 붙이는 거.**

```swift
// ❌ 동작 안 함
@State private var isShown = false

if isShown {
    Banner()
        .transition(.slide)
}
Button("Show") {
    isShown.toggle()   // 그냥 토글하면 transition 안 먹음
}
```

```swift
// ✅ withAnimation으로 상태 변화 감싸야 함
Button("Show") {
    withAnimation {
        isShown.toggle()
    }
}
```

[공식 문서](https://developer.apple.com/documentation/swiftui/view/transition(_:))도 같은 패턴. `.transition` modifier만 단독으로 쓰면 view는 등장하긴 하는데 애니메이션 없이 그냥 뙇 나타난다.

조합 가능:

```swift
Banner()
    .transition(.move(edge: .bottom).combined(with: .opacity))
```

`.combined(with:)`로 여러 트랜지션을 합치거나, `.asymmetric(insertion:removal:)`로 등장과 퇴장을 다르게 줄 수도 있음.

## matchedGeometryEffect — 두 view를 시각적으로 잇기

흔히 hero animation이라고 부르는 패턴. 두 view에 **같은 namespace + 같은 id**를 주면 SwiftUI가 둘을 같은 element로 보고 그 사이를 부드럽게 이어준다.

```swift
struct ContentView: View {
    @Namespace private var animationNamespace
    @State private var isExpanded = false

    var body: some View {
        VStack {
            if isExpanded {
                Image("cover")
                    .resizable()
                    .matchedGeometryEffect(id: "cover", in: animationNamespace)
                    .frame(height: 300)
            } else {
                Image("cover")
                    .resizable()
                    .matchedGeometryEffect(id: "cover", in: animationNamespace)
                    .frame(width: 60, height: 60)
            }
            Button("Toggle") {
                withAnimation(.spring(duration: 0.5, bounce: 0.2)) {
                    isExpanded.toggle()
                }
            }
        }
    }
}
```

작은 썸네일에서 큰 커버로 자연스럽게 확장되는 효과. 사진 앱이나 음악 앱의 디테일 진입 애니메이션이 이 패턴.

주의할 부분 두 개.

- **같은 id를 동시에 두 view에서 활성화하면 안 됨**. 위 예제처럼 if/else로 한 번에 하나만 살아있어야 함. 동시에 활성이면 SwiftUI가 어느 쪽 frame을 기준으로 잡을지 모름.
- **withAnimation 또는 .animation으로 상태 변화를 감싸야 함**. `.transition`이랑 같음.

## spring 애니메이션이 새로 깔끔해졌다

iOS 17부터 [`Animation.spring(duration:bounce:blendDuration:)`](https://developer.apple.com/documentation/swiftui/animation/spring(duration:bounce:blendduration:)) 형태가 권장. 이전에는 `response`/`dampingFraction` 같은 물리 파라미터를 직접 줘야 했는데, 새 API는 그냥 **얼마나 걸릴지(duration)** 와 **얼마나 튕길지(bounce)** 두 개로 끝남.

```swift
// 부드럽게
.spring(duration: 0.5, bounce: 0)

// 살짝 튕기게
.spring(duration: 0.5, bounce: 0.3)

// 많이 튕기게
.spring(duration: 0.5, bounce: 0.5)
```

bounce는 0~1 범위. 음수도 되는데(overdamped) 거의 안 씀.

## 정리

- 상태 변화를 감싸서 영향받는 view 다 같이 움직이게 → `withAnimation`
- 특정 view만 특정 값에 반응하게 → `.animation(_:value:)`
- 등장/퇴장 애니메이션 → `.transition` (단, `withAnimation`이랑 같이 써야 동작)
- 두 view 사이를 부드럽게 잇기 → `matchedGeometryEffect` + 같은 namespace + 같은 id
- 새 spring은 duration/bounce 두 개로 끝

세 modifier가 헷갈리는 게 보통 시작 단계라, 한 번 패턴 잡히면 그 뒤로는 거의 같은 구조의 반복임. 잡고 나면 SwiftUI 애니메이션이 UIKit `UIView.animate` 시절보다 진짜 편함.
