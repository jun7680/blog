+++
author = "오깅중"
title = "UICollectionView CellRegistration — 옛날 register/dequeue 그만 쓰자"
slug = "uikit-cell-registration"
date = "2026-05-12T13:30:00+09:00"
description = "iOS 14에서 들어온 UICollectionView.CellRegistration. 문자열 reuse ID 안 만들어도 되고, as! 캐스팅도 사라지고, cell 등록과 설정 코드가 한 곳으로 모인다. 단독으로도 쓸 수 있다."
categories = ["Swift"]
tags = ["UIKit", "UICollectionView", "CellRegistration", "iOS14"]
image = "thumbnail.png"
+++

iOS 14에서 들어온 API인데 의외로 잘 안 알려진 쪽. 옛날 `register(_:forCellWithReuseIdentifier:)` + `dequeueReusableCell(withReuseIdentifier:)` 패턴을 쓰지 않게 된다. 처음 보면 살짝 낯설 수 있는데, 한 번 잡아두면 옛날 패턴으로 안 돌아감.

[DiffableDataSource](/p/uikit-diffable-datasource-memo/) 자료에 같이 묶여 나오는 경우가 많아서 "DiffableDataSource 쓸 때만 쓰는 거" 같이 보이는데, 사실 **단독으로도 그냥 쓸 수 있다**. 옛날 `UICollectionViewDataSource` 그대로 가면서 cell 등록만 갈아도 ID 관리가 사라져서 깔끔해짐.

## 옛날 패턴

```swift
// viewDidLoad 어딘가
collectionView.register(CustomCell.self, forCellWithReuseIdentifier: "cell")

// cellForItemAt
func collectionView(_ collectionView: UICollectionView,
                    cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(
        withReuseIdentifier: "cell",
        for: indexPath
    ) as! CustomCell
    cell.configure(with: items[indexPath.item])
    return cell
}
```

세 가지가 분산돼 있다.

1. cell 클래스 등록 (viewDidLoad)
2. dequeue 후 강제 캐스팅 (`as! CustomCell`)
3. cell 설정 (configure 호출)

ID 문자열이 두 곳에 흩어져 있고, 캐스팅을 빼먹으면 컴파일은 되는데 cell 타입을 알 수 없어 메서드 호출이 안 된다.

## CellRegistration 패턴

```swift
let cellRegistration = UICollectionView.CellRegistration<CustomCell, Item> { cell, indexPath, item in
    cell.configure(with: item)
}

func collectionView(_ collectionView: UICollectionView,
                    cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let item = items[indexPath.item]
    return collectionView.dequeueConfiguredReusableCell(
        using: cellRegistration,
        for: indexPath,
        item: item
    )
}
```

세 가지가 한 덩어리로 모인다.

- **cell 클래스 + 구성 클로저**가 `CellRegistration` 인스턴스 안에 같이 묶여 있음
- 제네릭(`<CustomCell, Item>`)으로 **cell 타입과 item 타입이 둘 다 잡힘**. `as!` 캐스팅 사라짐
- **문자열 reuse ID 안 만들어도 됨**. registration 인스턴스 자체가 ID 역할

`cellRegistration`은 보통 ViewController의 lazy property로 들고 있으면 됨. lazy로 하면 viewDidLoad에 등록 코드 따로 안 박아도 처음 dequeue 시점에 자동으로 등록됨.

```swift
private lazy var cellRegistration = UICollectionView.CellRegistration<CustomCell, Item> { cell, _, item in
    cell.configure(with: item)
}
```

## DiffableDataSource랑 단독 사용

DiffableDataSource랑 같이 쓰면 자연스럽게 한 줄로 묶인다.

```swift
let dataSource = UICollectionViewDiffableDataSource<Section, Item>(
    collectionView: collectionView
) { collectionView, indexPath, item in
    collectionView.dequeueConfiguredReusableCell(
        using: cellRegistration,
        for: indexPath,
        item: item
    )
}
```

`numberOfItems`/`cellForItemAt` 자체를 안 짜도 된다. DiffableDataSource가 데이터를, CellRegistration이 cell 구성을 담당.

옛날 `UICollectionViewDataSource`를 그대로 쓰면서 CellRegistration만 도입해도 됨. cell 등록·캐스팅·ID 관리만 빠져도 화면 코드가 한참 짧아짐.

## SupplementaryRegistration도 있다

header/footer 같은 supplementary view용으로 [`UICollectionView.SupplementaryRegistration`](https://developer.apple.com/documentation/uikit/uicollectionview/supplementaryregistration)이 따로 있다. 사용 패턴은 거의 동일.

```swift
let headerRegistration = UICollectionView.SupplementaryRegistration<HeaderView>(
    elementKind: UICollectionView.elementKindSectionHeader
) { header, kind, indexPath in
    header.titleLabel.text = "Section Header"
}

dataSource.supplementaryViewProvider = { collectionView, kind, indexPath in
    collectionView.dequeueConfiguredReusableSupplementary(
        using: headerRegistration,
        for: indexPath
    )
}
```

## 흔한 사고 — registration 매번 새로 만들기

```swift
// ❌ cellForItemAt 안에서 매번 새로 만들면 안 됨
func collectionView(_ collectionView: UICollectionView,
                    cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cellRegistration = UICollectionView.CellRegistration<CustomCell, Item> { ... }
    return collectionView.dequeueConfiguredReusableCell(
        using: cellRegistration, for: indexPath, item: items[indexPath.item]
    )
}
```

`CellRegistration`은 만드는 시점에 cell 클래스를 collection view에 등록한다. 매번 새로 만들면 등록이 매번 일어나서 cell 재사용 풀이 꼬임. **lazy property나 ViewController 프로퍼티로 한 번 만들고 재사용**해야 함.

## UIKit minimum 버전이 14+면 새 코드는 다 이걸로

iOS 14+가 깔린 프로젝트면 새로 짜는 cell 등록 코드는 다 CellRegistration로 가는 게 표준. 옛 패턴 그대로 두는 코드는 그대로 두고, 새로 만지는 부분부터 점진적으로 바꿔도 한 ViewController 안에 두 패턴 섞여있어도 동작에 문제 없음.

처음 보면 "왜 이렇게 한 단계 더 거치지?" 싶은데, 실제로 옛 패턴 vs 새 패턴 cell 코드 양 비교하면 절반 가까이 줄어든다. 캐스팅 사라지는 게 진짜 큼.
