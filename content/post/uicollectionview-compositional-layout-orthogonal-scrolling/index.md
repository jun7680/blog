+++
author = "오깅중"
title = "UICollectionViewCompositionalLayout 가로 스크롤 섹션에서 삐끗한 것들"
slug = "uicollectionview-compositional-layout-orthogonal-scrolling"
date = "2026-06-01T10:50:00+09:00"
description = "UICollectionViewCompositionalLayout에서 orthogonalScrollingBehavior로 가로 스크롤 섹션을 만들 때 paging, group width, estimated size, section inset에서 자주 헷갈린 지점을 정리한다."
categories = ["Swift"]
tags = ["UIKit", "UICollectionView", "CompositionalLayout", "iOS13"]
image = "thumbnail.png"
+++

`UICollectionViewCompositionalLayout`은 처음 보면 꽤 그럴듯하다. 섹션마다 다른 레이아웃을 만들 수 있고, 한 화면 안에 세로 리스트와 가로 캐러셀을 같이 넣는 것도 `orthogonalScrollingBehavior` 한 줄이면 된다.

그런데 실제로 만지면 "왜 한 장씩 안 넘어가지?", "왜 셀이 화면 밖으로 애매하게 잘리지?", "왜 header가 같이 밀리지?" 같은 작은 삐끗함이 계속 나온다. [DiffableDataSource](/p/uikit-diffable-datasource-memo/)를 붙일 때는 데이터 쪽이 문제였고, CompositionalLayout에서는 대부분 **group 크기와 section 스크롤 정책을 헷갈린 것**이 문제였다.

환경은 iOS 13+ 기준. API 이름은 길지만 구조는 `item -> group -> section -> layout` 네 단계만 보면 된다.

## 가장 작은 기본형

가로 카드 섹션을 만든다고 하면 보통 이런 모양에서 시작한다.

```swift
private func makeCardSection() -> NSCollectionLayoutSection {
    let itemSize = NSCollectionLayoutSize(
        widthDimension: .fractionalWidth(1.0),
        heightDimension: .fractionalHeight(1.0)
    )
    let item = NSCollectionLayoutItem(layoutSize: itemSize)

    let groupSize = NSCollectionLayoutSize(
        widthDimension: .fractionalWidth(0.82),
        heightDimension: .absolute(180)
    )
    let group = NSCollectionLayoutGroup.horizontal(
        layoutSize: groupSize,
        subitems: [item]
    )

    let section = NSCollectionLayoutSection(group: group)
    section.orthogonalScrollingBehavior = .groupPagingCentered
    section.contentInsets = NSDirectionalEdgeInsets(
        top: 12,
        leading: 20,
        bottom: 24,
        trailing: 20
    )

    return section
}
```

여기서 핵심은 cell 하나가 아니라 **group 하나가 paging 단위**라는 점이다. item은 group 안에 들어가는 조각이고, section은 group들을 어떻게 나열하고 어떻게 스크롤할지 정한다.

Apple 문서에서도 [`UICollectionLayoutSectionOrthogonalScrollingBehavior`](https://developer.apple.com/documentation/uikit/uicollectionlayoutsectionorthogonalscrollingbehavior)는 section이 메인 스크롤 축과 직교하는 방향으로 어떻게 움직이는지 정하는 값으로 설명한다. 즉 세로 collection view 안에서 특정 section만 가로로 스크롤하게 만드는 설정이다.

## `.paging`과 `.groupPaging`은 다르다

처음 제일 많이 헷갈린 건 이거였다.

```swift
section.orthogonalScrollingBehavior = .paging
```

이름만 보면 카드 하나씩 넘어갈 것 같은데, `.paging`은 기본 scroll view paging에 가깝게 **collection view의 visible bounds 단위**로 넘어간다. 카드 group width를 80%로 잡아도 한 카드씩 딱딱 맞는 느낌이 아닐 수 있다.

카드 하나, 또는 내가 정의한 group 하나를 기준으로 넘기고 싶으면 보통 이쪽이 더 의도에 맞았다.

```swift
section.orthogonalScrollingBehavior = .groupPaging
```

가운데 정렬된 카드 캐러셀처럼 보이게 하려면:

```swift
section.orthogonalScrollingBehavior = .groupPagingCentered
```

대충 이렇게 기억하면 덜 헷갈린다.

| 옵션 | 느낌 |
|---|---|
| `.continuous` | 그냥 부드럽게 가로 스크롤 |
| `.continuousGroupLeadingBoundary` | 스크롤은 자유롭지만 group 앞쪽에 걸림 |
| `.paging` | 화면 bounds 기준 paging |
| `.groupPaging` | group 단위 paging |
| `.groupPagingCentered` | group 단위 paging + 가운데 정렬 |

가로 캐러셀 UI는 `.groupPaging`이나 `.groupPagingCentered`에서 시작하는 게 안전했다. `.paging`은 group 크기와 화면 폭이 거의 같을 때만 기대한 느낌이 난다.

## group width를 1.0으로 잡으면 캐러셀이 아니다

다음 실수는 group width를 너무 크게 잡는 것.

```swift
let groupSize = NSCollectionLayoutSize(
    widthDimension: .fractionalWidth(1.0),
    heightDimension: .absolute(180)
)
```

이러면 한 group이 collection view 폭을 전부 먹는다. 가로 스크롤은 되는데 다음 카드가 살짝 보이는 캐러셀 느낌은 없다. 카드가 옆에 이어지는지 사용자가 바로 알아보기 어렵다.

나는 보통 카드 섹션이면 group width를 `0.78 ~ 0.9` 사이에서 시작한다.

```swift
let groupSize = NSCollectionLayoutSize(
    widthDimension: .fractionalWidth(0.84),
    heightDimension: .absolute(180)
)
```

그리고 group 사이 간격은 item inset보다 section의 spacing으로 주는 쪽이 읽기 편했다.

```swift
section.interGroupSpacing = 12
```

item에 `contentInsets`를 주면 cell 내부 여백처럼 보이기도 하고, group size 계산과 섞여서 나중에 디버깅할 때 헷갈린다. 카드와 카드 사이 간격이면 `interGroupSpacing`, 섹션 바깥 여백이면 `section.contentInsets`로 나누는 게 낫다.

## estimated height는 편하지만 흔들릴 수 있다

동적 높이 셀이라서 바로 이렇게 쓰고 싶을 때가 있다.

```swift
let groupSize = NSCollectionLayoutSize(
    widthDimension: .fractionalWidth(0.84),
    heightDimension: .estimated(180)
)
```

가능은 하다. [`UICollectionViewCompositionalLayoutConfiguration`](https://developer.apple.com/documentation/uikit/uicollectionviewcompositionallayoutconfiguration) 예제에서도 header/footer 높이에 `.estimated(44)` 같은 값을 쓴다. 문제는 가로 orthogonal section에서 높이가 계속 다시 계산되면 스크롤 중에 레이아웃이 미세하게 튀는 느낌이 날 수 있다는 점이다.

카드 높이가 디자인상 고정이면 그냥 `.absolute`가 낫다.

```swift
heightDimension: .absolute(180)
```

텍스트 길이에 따라 정말 달라져야 한다면 estimated를 쓰되, cell Auto Layout constraint가 위아래로 닫혀 있어야 한다. label bottom constraint가 빠졌거나 compression resistance가 애매하면 collection view가 추정 높이를 계속 다시 잡으면서 흔들린다.

## header는 section 안에 붙여야 한다

섹션마다 제목을 붙일 때 layout 전체 configuration에 header를 넣는 방법도 있다. 하지만 그건 collection view 전체의 boundary supplementary item이다. 섹션별 제목이면 section에 붙이는 게 맞다.

```swift
let headerSize = NSCollectionLayoutSize(
    widthDimension: .fractionalWidth(1.0),
    heightDimension: .estimated(44)
)

let header = NSCollectionLayoutBoundarySupplementaryItem(
    layoutSize: headerSize,
    elementKind: UICollectionView.elementKindSectionHeader,
    alignment: .top
)

section.boundarySupplementaryItems = [header]
```

`orthogonalScrollingBehavior`를 켜도 header까지 가로로 같이 스크롤되는 게 아니라, section의 boundary supplementary item으로 남는다. 카드들은 가로로 움직이고 header는 세로 흐름 안에서 섹션 제목처럼 보인다. 보통 우리가 원하는 홈 화면 섹션 구조가 이쪽이다.

`UICollectionViewCompositionalLayoutConfiguration`의 `boundarySupplementaryItems`는 전체 layout의 header/footer가 필요할 때 쓰는 쪽으로 생각하면 덜 헷갈린다.

## 섹션별 layout은 sectionProvider로 빼는 게 편하다

여러 섹션을 섞는 순간 layout 클로저가 길어진다.

```swift
let layout = UICollectionViewCompositionalLayout { sectionIndex, environment in
    switch Section(rawValue: sectionIndex) {
    case .hero:
        return Self.makeHeroSection(environment: environment)
    case .recommend:
        return Self.makeCardSection(environment: environment)
    case .list:
        return Self.makeListSection(environment: environment)
    case nil:
        return nil
    }
}
```

여기서 `environment.container.effectiveContentSize.width`를 보면 iPhone/iPad 폭에 따라 group width를 다르게 줄 수 있다.

```swift
private static func makeCardSection(
    environment: NSCollectionLayoutEnvironment
) -> NSCollectionLayoutSection {
    let containerWidth = environment.container.effectiveContentSize.width
    let groupFraction: CGFloat = containerWidth > 600 ? 0.42 : 0.84

    let groupSize = NSCollectionLayoutSize(
        widthDimension: .fractionalWidth(groupFraction),
        heightDimension: .absolute(180)
    )

    // item, group, section 구성...
}
```

iPad에서 `0.84`를 그대로 쓰면 카드 하나가 너무 넓어져서 이상하다. CompositionalLayout은 sectionProvider에서 environment를 받을 수 있으니, size class 분기를 view controller 바깥에 흩뿌리지 않아도 된다.

## 내가 잡은 기준

지금은 가로 섹션을 만들 때 이 순서로 잡는다.

1. 세로 collection view 안에 가로 섹션이 필요한지 먼저 확인
2. 카드 한 장이 paging 단위면 `.groupPagingCentered`부터 시작
3. group width는 `1.0` 말고 다음 카드가 살짝 보이는 값으로 시작
4. 카드 사이 간격은 `section.interGroupSpacing`
5. 카드 높이가 고정이면 `.absolute`, 정말 필요할 때만 `.estimated`
6. 섹션 제목은 `section.boundarySupplementaryItems`
7. iPad 대응은 `NSCollectionLayoutEnvironment`에서 container width 보고 조정

DiffableDataSource가 데이터 변경을 정리해준다면, CompositionalLayout은 화면 구조를 section 단위로 정리해준다. 둘을 같이 쓰면 ViewController에서 `IndexPath` 계산과 레이아웃 분기 코드가 많이 빠진다.

다만 `orthogonalScrollingBehavior` 한 줄만 믿고 들어가면 paging 단위, group 크기, estimated height에서 바로 삐끗한다. CompositionalLayout은 "cell 크기"를 정하는 API라기보다 **section 안에서 group이 반복되는 규칙을 정하는 API**라고 보는 편이 더 잘 맞았다.
