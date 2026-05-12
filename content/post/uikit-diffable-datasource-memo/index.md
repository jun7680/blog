+++
author = "오깅중"
title = "UICollectionViewDiffableDataSource 쓰면서 정리한 메모"
slug = "uikit-diffable-datasource-memo"
date = "2026-05-12T13:00:00+09:00"
description = "UITableView/UICollectionView 데이터 소스의 새 표준. 옛날 cellForItemAt 패턴에서 DiffableDataSource로 옮기면서 정리한 기본 사용법, snapshot 동작, 흔한 사고."
categories = ["Swift"]
tags = ["UIKit", "UICollectionView", "DiffableDataSource", "iOS13"]
image = ""
+++

`UICollectionViewDiffableDataSource`는 iOS 13에서 들어온 데이터 소스 패턴. 기존 `cellForItemAt` + `numberOfItems` + `performBatchUpdates` 묶음을 **snapshot 한 번 적용**으로 갈음한다. 옛날 코드에서 옮기면서 정리한 메모.

## 옛날 패턴이랑 어떻게 다른가

기존 `UICollectionViewDataSource` 시절에는 데이터 추가/삭제할 때마다 IndexPath 계산해서 `performBatchUpdates`에 직접 넘겼다. 이게 약간만 잘못돼도 `NSInternalInconsistencyException` 크래시가 났다.

```swift
// 옛날 패턴 — 직접 IndexPath 관리
self.items.append(newItem)
self.collectionView.performBatchUpdates({
    let indexPath = IndexPath(item: self.items.count - 1, section: 0)
    self.collectionView.insertItems(at: [indexPath])
})
```

DiffableDataSource는 **데이터 자체의 snapshot을 던지면, 이전 snapshot이랑 비교해서 DiffableDataSource가 알아서 insert/delete/move를 계산**한다.

```swift
// 새 패턴 — snapshot만 던지면 끝
var snapshot = dataSource.snapshot()
snapshot.appendItems([newItem], toSection: .main)
dataSource.apply(snapshot, animatingDifferences: true)
```

배열만 바꾸고 snapshot 적용. IndexPath 계산 직접 안 해도 됨.

## 기본 셋업

Section과 Item 둘 다 `Hashable` 채택해야 함. enum이나 struct 어느 쪽이든 OK.

```swift
enum Section: Hashable {
    case main
}

struct Item: Hashable {
    let id: UUID
    let title: String
}
```

DataSource 생성 + cell 만드는 클로저:

```swift
let cellRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, Item> { cell, indexPath, item in
    var content = cell.defaultContentConfiguration()
    content.text = item.title
    cell.contentConfiguration = content
}

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

iOS 14부터 들어온 [`CellRegistration`](/p/uikit-cell-registration/)을 같이 쓰면 cell 등록 문자열 ID도 안 만들어도 된다. `register(...)` + `dequeueReusableCell(withReuseIdentifier:)` 묶음이 통째로 사라짐. 옛날 패턴이랑 어떻게 다른지는 [따로 정리한 글](/p/uikit-cell-registration/) 참고.

## Snapshot 다루기

snapshot은 **value type**. 매번 새로 만들거나 기존 snapshot을 복사해서 수정한 뒤 다시 apply.

```swift
var snapshot = NSDiffableDataSourceSnapshot<Section, Item>()
snapshot.appendSections([.main])
snapshot.appendItems(items, toSection: .main)

dataSource.apply(snapshot, animatingDifferences: true)
```

부분 업데이트:

```swift
var snapshot = dataSource.snapshot()
snapshot.deleteItems([item1])
snapshot.insertItems([newItem], beforeItem: item2)
snapshot.reloadItems([item3])
dataSource.apply(snapshot, animatingDifferences: true)
```

`reloadItems`는 cell 자체를 다시 그리고, `reconfigureItems`(iOS 15+)는 cell 재사용 없이 contentConfiguration만 갱신한다. 후자가 더 가벼우니 셀 내용만 바뀌는 경우에는 reconfigure가 낫다.

## 흔한 사고 몇 가지

### Item이 진짜로 unique하지 않은 경우

snapshot에 같은 Item을 두 번 넣으면 런타임에 죽는다. `Hashable` 자동 구현이 모든 프로퍼티를 비교하기 때문에, 보기엔 다른 두 모델이 모든 필드가 같으면 같은 Item으로 인식된다.

```swift
struct Item: Hashable {
    let title: String   // id가 없으면 같은 title이 나오는 순간 중복
}
```

서버에서 받은 모델이 ID 없이 텍스트만 있는 경우 자주 걸린다. 해결은 서버 ID를 들고 오거나, `UUID`를 클라이언트에서 생성해서 부여하거나, `Hashable`을 직접 구현해서 ID만 비교하게 하는 방향.

### Background thread에서 apply

`apply`는 main thread에서 호출해야 한다. 백그라운드에서 부르면 일부 iOS 버전에서 그냥 동작 안 함 또는 race로 죽음. 비동기 데이터 받아서 적용할 때는 `await MainActor.run { ... }`이나 `DispatchQueue.main.async` 필수.

### `animatingDifferences: true`인데 첫 적용에서 어색한 애니메이션

처음 데이터를 채울 때(`apply` 첫 호출) `animatingDifferences: true`면 빈 상태에서 모든 row가 한꺼번에 떨어지는 어색한 애니메이션이 나온다. 첫 적용은 `false`로, 이후 변경부터 `true`로 가는 게 자연스러움.

```swift
dataSource.apply(snapshot, animatingDifferences: false)   // 초기 로드
// ...
dataSource.apply(updatedSnapshot, animatingDifferences: true)  // 이후 변경
```

## SectionSnapshot으로 outline/expansion

iOS 14부터 `NSDiffableDataSourceSectionSnapshot`이 추가됨. 부모-자식 계층 + 펼치기/접기 동작이 필요한 화면(파일 브라우저, 카테고리 트리 등)에 쓴다.

```swift
var sectionSnapshot = NSDiffableDataSourceSectionSnapshot<Item>()
sectionSnapshot.append([parent])
sectionSnapshot.append([child1, child2], to: parent)
sectionSnapshot.expand([parent])

dataSource.apply(sectionSnapshot, to: .main, animatingDifferences: true)
```

평범한 리스트면 안 써도 되고, 트리 구조 만들 때만 꺼내쓰면 됨.

## UICollectionViewLayout이랑은 별개

자주 헷갈리는 게, DiffableDataSource는 **데이터 소스**고 layout은 따로다. `UICollectionViewFlowLayout` 그대로 쓰면서 데이터 소스만 Diffable로 갈아도 된다. 다만 iOS 13+ 새 코드 짜는 거면 [`UICollectionViewCompositionalLayout`](https://developer.apple.com/documentation/uikit/uicollectionviewcompositionallayout)이랑 같이 묶어서 쓰는 게 표준 조합. 이건 다음에 따로 정리.

---

UITableView/UICollectionView 옛날 데이터 소스 패턴은 IndexPath 계산이 진짜 골치였는데, DiffableDataSource는 그 부분이 통째로 빠진다. 한 번 패턴 잡히면 다시 옛날 패턴으로 돌아가기 싫음. iOS 13+가 깔린 프로젝트면 새 코드는 이걸로 가는 게 표준.
