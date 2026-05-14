+++
author = "오깅중"
title = "Bool 한 개에 결정 세 개 묶었을 때"
slug = "swiftui-shared-component-bool-option-splitting"
date = "2026-05-14T16:26:18+09:00"
description = "공용 컴포넌트의 옵션 한 개가 사실은 결정 세 개였다. 정책이 갈라지는 순간 쪼개야 한다."
categories = [
    "Swift"
]
tags = [
    "SwiftUI",
    "DesignSystem",
    "APIDesign",
    "Refactoring",
    "ComponentDesign"
]
image = "thumbnail.png"
+++

## 도입

공용 SwiftUI 업로드 섹션 컴포넌트가 있다. 처음 만들 때 화면 두 곳에서 썼다. 둘 다 디바이더가 같은 자리에 있었다. `showsDividers: Bool = true` 옵션 하나 만들고 끝났다.

새 화면 두 곳이 더 들어왔다. 이제 디바이더 정책이 모두 다르다. 옵션 하나로는 표현이 안 된다.

## 무슨 일이 벌어졌나

기존 컴포넌트의 디바이더 위치는 세 곳이었다.

1. 헤더 아래
2. 펼친 리스트와 더보기 토글 사이
3. 더보기 토글 아래

`showsDividers: Bool` 하나가 이 셋을 동시에 켜고 끈다. 화면 A는 셋 다 켜야 했고, 화면 B는 셋 다 꺼야 했다. 그래서 단일 Bool로 충분했다.

화면 C가 들어왔다. "헤더 아래는 있고 더보기 위는 없고 더보기 아래는 있어야 한다." 단일 Bool로는 표현이 안 된다.

## 잘못된 우회

`showsDividers: true`로 켜고, 더보기 위 디바이더만 수동으로 가리는 코드를 사용처에 넣는다? `.overlay`로 흰 영역을 덮어쓴다? 동작은 한다. 그런데 의도가 코드에서 사라진다. 6개월 후에 보면 왜 흰 사각형이 거기 있는지 모른다.

이런 식의 우회는 컴포넌트 인터페이스의 한계를 사용처에 떠넘기는 거다. 컴포넌트가 "내가 표현 못 하는 정책은 너희가 알아서 가려"라고 말하는 셈이고, 그게 쌓이면 공용 컴포넌트가 공용이 아닌 게 된다.

## 문제 코드

처음 만들었을 때 시그니처는 이거 하나였다.

```swift
struct UploadSectionView: View {
    let showsDividers: Bool

    init(
        // ...
        showsDividers: Bool = true
        // ...
    ) {
        // ...
    }
}
```

사용처에서는 이렇게 부른다.

```swift
// 화면 A: 디바이더 셋 다 켬
UploadSectionView(/* ... */)

// 화면 B: 셋 다 끔
UploadSectionView(
    // ...
    showsDividers: false
)

// 화면 C: 가운데만 끄고 싶은데... 표현 불가
UploadSectionView(
    // ...
    showsDividers: true  // 가운데도 같이 켜짐
)
```

`showsDividers` 한 줄이 헤더 아래/더보기 위/더보기 아래 세 디바이더를 동시에 켜고 끈다. 화면 C는 "가운데만 끔"이 안 된다. true냐 false냐 둘 중 하나로 떨어뜨려야 하는데 어느 쪽도 정답이 아니다.

## 해결 코드 — 의미 단위로 쪼갠다

```swift
struct UploadSectionView: View {
    let showsHeaderDivider: Bool
    let showsMoreTopDivider: Bool
    let showsMoreBottomDivider: Bool

    init(
        // ...
        showsHeaderDivider: Bool = true,
        showsMoreTopDivider: Bool = true,
        showsMoreBottomDivider: Bool = true
        // ...
    ) {
        // ...
    }
}
```

각 디바이더의 의미가 옵션 이름에 그대로 드러난다. 사용처는 자기가 무엇을 켜고 끄는지 정확히 안다. 기본값을 전부 true로 두면 기존 두 사용처는 무수정으로 살아남는다.

사용처는 이런 식으로 쓴다.

```swift
// 화면 A: 셋 다 켬 (기본값이라 생략 가능)
UploadSectionView(/* ... */)

// 화면 B: 셋 다 끔
UploadSectionView(
    // ...
    showsHeaderDivider: false,
    showsMoreTopDivider: false,
    showsMoreBottomDivider: false
)

// 화면 C: 가운데만 끔
UploadSectionView(
    // ...
    showsMoreTopDivider: false
)
```

화면 C의 의도가 호출부에서 한눈에 보인다. "가운데 디바이더만 끈다." 이게 핵심이다.

## 단일 Bool의 무엇이 문제였나

옵션을 합치면 "디바이더"라는 개념이 하나처럼 보인다. 사실은 세 가지 다른 결정이었다. 단일 Bool이 결정 세 개를 강제로 묶은 거다.

이런 묶음은 정책 변화에 약하다. 처음 두 사용처가 운 좋게 정책이 같았던 것뿐, 컴포넌트 인터페이스는 더 정밀해야 했다.

## 너무 일찍 쪼개도 안 된다

반대로 처음부터 디바이더 셋을 개별 옵션으로 만들면 그것대로 짐이다. 사용처가 매번 세 줄을 써야 하고, 정책이 같은데 우연히 옵션 하나만 false를 적었을 때 일관성이 깨진다.

원칙: 사용처가 늘어나면서 정책이 갈라지는 순간에 쪼갠다. 그전엔 단일 옵션이 맞다. **쪼개야 할 시점은 정책이 갈라지는 시점이지 코드 작성 시점이 아니다.**

YAGNI와 한 끗 차이다. "언젠가 다를 수도 있으니까"로 쪼개면 미래에 일어나지 않을 일을 위해 지금 비용을 낸다. "지금 갈라졌다"가 신호다.

## 마이그레이션 — 호출처를 잊지 마라

기존 단일 Bool을 세 옵션으로 쪼개면 시그니처가 바뀐다. 호출처가 옛 이름을 그대로 들고 있으면 빌드가 깨진다. 새 옵션의 default를 잘 잡아도 옛 이름은 더 이상 존재하지 않는 인자라 컴파일러가 잡아낸다.

이걸 잊고 시그니처만 바꾸면 컴파일 에러로 시간을 더 쓴다. 시그니처 분리와 사용처 마이그레이션을 같은 PR에 묶는다.

컴파일러가 잡아준다고 안심하지 않는다. PR 단위로 보면 잘 잡히는데, feature 브랜치를 길게 끌면 다른 사람이 새 호출처를 계속 추가한다. 그 사이에 시그니처 분리가 들어가면 머지 직후 빌드가 깨진다.

## 정리

- 옵션 이름이 의미하는 결정의 단위가 사용처마다 다르면, 옵션은 더 쪼개야 한다.
- 단일 Bool은 "이 셋은 항상 같이 켜지고 꺼진다"는 강한 약속이다. 그 약속이 깨지는 순간 쪼갠다.
- 새 옵션은 default를 기존 동작과 같게 둔다. 그러면 기존 사용처가 무수정으로 살아남는다.
- 시그니처 변경과 호출처 마이그레이션은 항상 한 PR에.
