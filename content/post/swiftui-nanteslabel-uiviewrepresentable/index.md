+++
author = "오깅중"
title = "SwiftUI에서 NantesLabel 살리기"
slug = "swiftui-nanteslabel-uiviewrepresentable"
date = "2026-05-14T16:26:21+09:00"
description = "SwiftUI Text로는 안 되는 자동 링크 탐지, 줄 수 제한, 더 보기 토글을 UIKit NantesLabel을 UIViewRepresentable로 래핑해서 해결한 패턴과 네 가지 함정 정리."
categories = ["Swift"]
tags = ["SwiftUI", "UIKit", "UIViewRepresentable", "NantesLabel", "Bridging"]
image = "thumbnail.png"
+++

코멘트 영역을 SwiftUI로 짜고 있었다. 요구사항은 셋이다.

1. www 링크를 자동 탐지해서 파란색으로 표시하고 탭하면 브라우저를 연다
2. 4줄까지 노출하고 그 이상은 말줄임 + "더 보기" 토글
3. 다이나믹 타입 대응

SwiftUI `Text`로는 셋 다 안 된다. `Text` 자체에 자동 링크 탐지가 없고, 줄 수 제한과 "더 보기" 토글을 같이 처리하기도 빈약하다. 기존 UIKit 화면에서는 `NantesLabel` 라이브러리로 다 해결돼 있었다.

새로 짤 시간은 없다. 가져다 쓰자.

## UIViewRepresentable로 래핑

```swift
struct NantesLabelView: UIViewRepresentable {
    let text: String
    let maxLines: Int
    let onTapMore: () -> Void

    func makeUIView(context: Context) -> NantesLabel {
        let label = NantesLabel()
        label.numberOfLines = maxLines
        label.delegate = context.coordinator
        label.enabledTextCheckingTypes = NSTextCheckingResult.CheckingType.link.rawValue
        return label
    }

    func updateUIView(_ label: NantesLabel, context: Context) {
        label.text = text
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTapMore: onTapMore)
    }

    final class Coordinator: NSObject, NantesLabelDelegate {
        let onTapMore: () -> Void
        init(onTapMore: @escaping () -> Void) {
            self.onTapMore = onTapMore
        }

        func attributedLabel(_ label: NantesLabel, didSelectLinkWith url: URL) {
            UIApplication.shared.open(url)
        }
    }
}
```

핵심은 셋이다.

- `makeUIView`에서 UIKit 인스턴스를 만들고 초기 설정을 한다
- `updateUIView`에서 SwiftUI state 변경을 UIKit 인스턴스에 반영한다
- delegate는 `Coordinator`에 둔다. `UIViewRepresentable` 자체는 struct라 delegate를 직접 채택하지 못한다

## 함정 1 — intrinsicContentSize

UIKit label의 height는 내용에 따라 변한다. SwiftUI는 `UIViewRepresentable`이 자기 intrinsic size를 어떻게 표현하는지에 따라 layout을 결정한다. SwiftUI가 width를 정해주고 label의 intrinsic height를 자동으로 받아야 한다.

iOS 16+에서는 `UIHostingController`에 `sizingOptions = .intrinsicContentSize`가 있지만, `UIViewRepresentable` 안에서는 SwiftUI가 자동으로 처리한다. `NantesLabel`이 표준 `intrinsicContentSize`를 잘 구현하면 무리 없이 동작한다.

문제가 생기면 `.fixedSize(horizontal: false, vertical: true)` modifier로 강제할 수 있다.

## 함정 2 — updateUIView가 자주 호출된다

SwiftUI는 부모 state가 바뀔 때마다 `updateUIView`를 호출한다. 매번 label의 모든 속성을 재설정하면 비싸다. 비교 후 바뀐 것만 적용하거나, label 속성이 stable하면 `makeUIView`에서 한 번만 설정하고 `updateUIView`에서는 `text`만 갱신한다.

## 함정 3 — 다이나믹 타입

UIKit label은 `adjustsFontForContentSizeCategory = true`로 설정하면 다이나믹 타입을 자동으로 따른다. SwiftUI Environment의 `\.sizeCategory`도 받을 수 있지만 `NantesLabel`이 자체적으로 처리하게 두는 쪽이 단순하다.

## 함정 4 — link 색상

`NantesLabel`의 link 색상은 `linkAttributes`로 설정한다.

```swift
label.linkAttributes = [
    .foregroundColor: UIColor.systemBlue,
    .underlineStyle: NSUnderlineStyle.single.rawValue
]
```

SwiftUI `Color`로 받아서 `UIColor`로 변환하면 다크모드 자동 대응도 가능하다.

## 문제 코드

처음엔 그냥 SwiftUI `Text`가 NantesLabel처럼 동작해주길 바라고 써봤다. 당연히 안 된다.

```swift
struct CommentView: View {
    let text: String

    var body: some View {
        // SwiftUI Text는 자동 URL 탐지가 없다.
        // lineLimit + "더 보기" 토글도 직접 짜야 한다.
        Text(text)
            .lineLimit(4)
            .truncationMode(.tail)
    }
}
```

그래서 NantesLabel 자체를 SwiftUI body 안에 직접 써보려 했는데, `NantesLabel`은 `UIView` 서브클래스라 `View`가 아니다. 컴파일도 안 된다.

```swift
struct CommentView: View {
    let text: String

    var body: some View {
        // 컴파일 에러: NantesLabel은 SwiftUI View가 아니다.
        // 'NantesLabel' is not convertible to 'some View'
        NantesLabel().apply {
            $0.text = text
            $0.numberOfLines = 4
            $0.enabledTextCheckingTypes = NSTextCheckingResult.CheckingType.link.rawValue
        }
    }
}
```

UIKit 컴포넌트를 SwiftUI 안에 그대로 끼우려고 한 게 잘못이다. SwiftUI는 `UIViewRepresentable`이라는 다리를 명시적으로 요구한다.

## 해결 코드

`UIViewRepresentable`로 래핑하고, delegate는 `Coordinator`에 위임한다. 아래는 복붙해서 바로 쓸 수 있는 완성본이다. 링크 색상·다이나믹 타입·width 자동 처리·"더 보기" 콜백까지 다 들어있다.

```swift
import SwiftUI
import Nantes

struct NantesLabelView: UIViewRepresentable {
    let text: String
    let maxLines: Int
    let font: UIFont
    let textColor: UIColor
    let linkColor: UIColor
    let onTapMore: () -> Void

    init(
        text: String,
        maxLines: Int = 4,
        font: UIFont = .preferredFont(forTextStyle: .body),
        textColor: UIColor = .label,
        linkColor: UIColor = .systemBlue,
        onTapMore: @escaping () -> Void = {}
    ) {
        self.text = text
        self.maxLines = maxLines
        self.font = font
        self.textColor = textColor
        self.linkColor = linkColor
        self.onTapMore = onTapMore
    }

    func makeUIView(context: Context) -> NantesLabel {
        let label = NantesLabel()
        label.delegate = context.coordinator

        // stable 속성은 makeUIView에서 한 번만.
        label.numberOfLines = maxLines
        label.font = font
        label.textColor = textColor
        label.adjustsFontForContentSizeCategory = true
        label.enabledTextCheckingTypes = NSTextCheckingResult.CheckingType.link.rawValue
        label.linkAttributes = [
            .foregroundColor: linkColor,
            .underlineStyle: NSUnderlineStyle.single.rawValue
        ]

        // SwiftUI가 width만 잡아주고 height는 라벨이 알아서 측정하도록.
        label.setContentHuggingPriority(.required, for: .vertical)
        label.setContentCompressionResistancePriority(.required, for: .vertical)

        return label
    }

    func updateUIView(_ label: NantesLabel, context: Context) {
        // 매 호출마다 모든 속성을 재설정하지 않는다. text만 바뀔 가능성이 높다.
        if label.text != text {
            label.text = text
        }
        context.coordinator.onTapMore = onTapMore
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onTapMore: onTapMore)
    }

    final class Coordinator: NSObject, NantesLabelDelegate {
        var onTapMore: () -> Void

        init(onTapMore: @escaping () -> Void) {
            self.onTapMore = onTapMore
        }

        func attributedLabel(_ label: NantesLabel, didSelectLinkWith url: URL) {
            UIApplication.shared.open(url)
        }
    }
}
```

호출부는 이렇게 쓴다. `.fixedSize(horizontal: false, vertical: true)`로 height를 라벨에 맡긴다.

```swift
struct CommentView: View {
    let text: String
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NantesLabelView(
                text: text,
                maxLines: expanded ? 0 : 4,
                onTapMore: { expanded.toggle() }
            )
            .fixedSize(horizontal: false, vertical: true)

            if !expanded {
                Button("더 보기") { expanded = true }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
```

이렇게 두면 자동 URL 탐지·다이나믹 타입·다크모드 link 색상까지 다 따라온다. "더 보기"는 SwiftUI `@State`로 줄 수 제한만 토글하면 끝난다.

## 더 가벼운 대안

SwiftUI iOS 15+의 `AttributedString` + Markdown으로 일부 링크 처리는 가능하다. 다만 자동 URL 탐지, "더 보기" 토글, 줄 수 제한을 정밀하게 컨트롤하기 어렵다. 기존 UIKit 라이브러리가 이미 잘 동작하면 가져다 쓰는 쪽이 시간 대비 결과가 좋다.

## 교훈

- UIKit 단독 라이브러리를 SwiftUI에서 살리는 가장 단순한 패턴은 `UIViewRepresentable` 래핑이다. 일주일짜리 자체 구현 대신 한 시간으로 끝난다.
- delegate가 있는 UIKit 컴포넌트를 래핑할 땐 `Coordinator`로 묶어라. `UIViewRepresentable` struct가 직접 delegate를 채택할 수 없다.
- `updateUIView`는 자주 호출된다. 매번 모든 속성을 재설정하지 마라. 바뀐 것만 반영하거나 stable한 속성은 `makeUIView`에서 한 번만 설정해라.
- intrinsic size가 깨지면 `.fixedSize(horizontal: false, vertical: true)`로 강제할 수 있다. SwiftUI가 width만 정해주고 height를 자동 측정한다.
- 모든 UIKit 라이브러리를 새로 SwiftUI 네이티브로 짤 필요는 없다. 마이그레이션 비용을 인정하고 일부는 래핑으로 두는 쪽이 현실적이다.

> 환경: Xcode 26.4 / iOS 17+
