+++
author = "오깅중"
title = "SwiftUI List 스크롤 끊길 때 점검하는 메모"
slug = "swiftui-list-lazyvstack-performance"
date = "2026-05-12T12:00:00+09:00"
description = "SwiftUI List/LazyVStack 스크롤이 끊기거나 셀이 깜빡일 때 가장 먼저 보는 곳들. ForEach id, 셀 안 ViewModel 생성, AsyncImage 캐싱, 무거운 body 계산까지."
categories = ["Swift"]
tags = ["SwiftUI", "Performance", "List", "LazyVStack", "ForEach"]
image = ""
+++

SwiftUI에서 List나 LazyVStack에 row 100개 넣었더니 스크롤이 뚝뚝 끊기는 게 보인다. UIKit `UITableView`/`UICollectionView`보다 손이 덜 가는 대신 안 보이는 함정이 좀 있다. 디버깅하면서 매번 같은 패턴이 나와서 메모로 남긴다.

## List와 LazyVStack 둘 다 lazy인데 차이가 있다

먼저 짚어둘 것. 공식 문서 ([Picking container views for your content](https://developer.apple.com/documentation/swiftui/picking-container-views-for-your-content))에 따르면 `List`는 개념적으로 `LazyVStack + ScrollView`에 플랫폼 스타일링이 입혀진 것. 둘 다 row를 lazy로 그린다. 차이는 이 정도.

| | List | LazyVStack |
|---|---|---|
| 셀 재사용 | 일반적으로 됨 | 안 됨 (한 번 그린 건 메모리에 유지) |
| 구분선·swipe-to-delete | 기본 | 직접 구현 |
| ScrollView 감싸기 | 내장 | 직접 |
| 헤더·섹션 스타일 | 기본 제공 | 직접 |

**스크롤 안 끊긴다고 LazyVStack을 마구 쓰면 메모리가 계속 쌓인다**. row 수천 개 띄울 거면 `List`가 안전. 화면에 한두 페이지만 띄울 거면 `LazyVStack`도 OK.

## ForEach 안의 `if`부터 의심

공식 문서가 직접 경고하는 패턴. ForEach 클로저 안에서 if로 뷰를 골라 그리면 **각 element가 1개나 0개 view를 만들 수 있어서** lazy 컨테이너가 최적화를 못 한다.

```swift
// ❌ 안티패턴
ForEach(items) { item in
    if item.shouldShow {
        ItemRow(item: item)
    }
}
```

```swift
// ✅ VStack/HStack/ZStack 같은 컨테이너로 감싸서 view count 고정
ForEach(items) { item in
    VStack {
        if item.shouldShow {
            ItemRow(item: item)
        }
    }
}
```

또는 그냥 `filter`로 미리 거르고 들어가는 게 더 깔끔하다.

```swift
ForEach(items.filter { $0.shouldShow }) { item in
    ItemRow(item: item)
}
```

[공식 문서](https://developer.apple.com/documentation/swiftui/foreach)에 디버깅 launch argument도 박혀 있다. `-LogForEachSlowPath YES`를 Scheme의 Arguments에 추가하면 SwiftUI가 non-constant view count 만날 때마다 콘솔에 로그 찍어준다. 안 봤으면 한 번 켜보길 권함.

## ForEach `id:` 누락 → 매번 전체 재계산

`ForEach`가 element identity를 잃으면 데이터 바뀔 때마다 전체 row가 재계산된다. 두 가지 방법.

```swift
// 방법 1 — 모델이 Identifiable 채택
struct Item: Identifiable {
    let id: UUID
    let title: String
}

ForEach(items) { item in
    ItemRow(item: item)
}
```

```swift
// 방법 2 — id: KeyPath 명시
ForEach(items, id: \.uuid) { item in
    ItemRow(item: item)
}
```

가장 자주 보는 사고는 `ForEach(0..<items.count, id: \.self)` 패턴. 인덱스를 id로 쓰면 **중간에 한 row가 삭제될 때 그 뒤 모든 row의 identity가 바뀐다**. 결과적으로 변경 안 된 row들도 전부 다시 그려짐. row 모델이 `Identifiable`이거나 안정적인 unique key가 있으면 그걸 써야 함.

## 셀 안에서 `@StateObject` 새로 만들면 매 reuse마다 새 인스턴스

```swift
// ❌ 셀 reuse 때마다 ViewModel 새로 생성
struct ItemRow: View {
    let item: Item
    @StateObject private var vm = ItemRowViewModel()

    var body: some View { ... }
}
```

`@StateObject`는 View identity 기준 한 번만 생성된다는 게 보장이긴 한데, **List 셀처럼 identity가 바뀌면서 reuse되는 상황에선 매번 새로 만들어진다**. 한 row가 viewmodel 하나씩 들고 있어야 할 정당한 이유가 없으면 부모에서 만들어서 주입하는 게 낫다. iOS 17+면 `@Observable` + `@State`로 같은 패턴이 더 가벼움 (이전 글 [iOS 17 이후 @StateObject는 거의 안 쓰게 됐다](/p/state-stateobject-observedobject-observable-ios17/) 참고).

## AsyncImage는 캐싱이 없다

```swift
// ❌ 스크롤 위아래로 움직일 때마다 같은 이미지 재요청
List(items) { item in
    HStack {
        AsyncImage(url: item.thumbnailURL)
            .frame(width: 60, height: 60)
        Text(item.title)
    }
}
```

`AsyncImage`는 디스크/메모리 캐싱이 없다. 같은 셀이 화면에 다시 들어올 때마다 네트워크 요청이 다시 나간다. row 수가 적으면 모르겠는데, 50개 넘어가면 체감되기 시작함. 해결은 보통 외부 라이브러리.

- [SDWebImageSwiftUI](https://github.com/SDWebImage/SDWebImageSwiftUI)
- [Kingfisher](https://github.com/onevcat/Kingfisher)
- [Nuke](https://github.com/kean/Nuke)

셋 다 SwiftUI 친화적이고 캐싱·다운샘플링·플레이스홀더를 다 들고 있다. 직접 `URLCache + NSCache`로 짜도 되긴 하는데, 이미지 디코딩 메인 스레드 차단까지 신경 쓰려면 외부 라이브러리가 빠르고 안전.

## 셀 body 안에서 무거운 계산 X

```swift
// ❌ body가 호출될 때마다 정렬·필터링 다시
struct ItemRow: View {
    let item: Item
    var body: some View {
        VStack {
            Text(item.title)
            Text(item.tags.sorted().joined(separator: ", "))   // 매번 정렬
        }
    }
}
```

```swift
// ✅ 미리 가공해서 넘기거나 computed property로
struct ItemRow: View {
    let item: Item
    private var tagText: String {
        item.tags.sorted().joined(separator: ", ")
    }
    var body: some View {
        VStack {
            Text(item.title)
            Text(tagText)
        }
    }
}
```

`body`는 SwiftUI가 보기에 자주 호출되는 함수다. 정렬, 큰 배열 매핑, 날짜 포맷팅, 정규식 같은 게 body 안에 들어가면 스크롤 한 번에 전체 셀이 다 같은 작업을 또 하게 된다. **body는 가능한 가벼운 view 조합만**, 데이터 가공은 모델 단계에서 끝내고 들어가는 게 안전.

날짜 포맷터도 자주 걸리는 부분. `DateFormatter` 인스턴스를 body 안에서 새로 만들면 꽤 비싸다. static let으로 한 번만 만들거나 모델 안에 캐싱해두자.

## 측정은 Instruments로

추측으로 가지 말고 진짜 무거운 곳을 찾아봐야 한다.

- **Instruments → SwiftUI template**: View body 호출 횟수, 재계산 지점, hitch 발생 시점을 다 보여준다. Xcode 15부터 들어온 가장 강력한 SwiftUI 디버깅 도구.
- **`-LogForEachSlowPath YES`**: 위에서 말한 ForEach non-constant view count 로그.
- **`Self._printChanges()`**: View body 안에 한 줄 추가하면 어떤 프로퍼티 변경이 다시 그리게 했는지 콘솔에 찍어준다.

```swift
struct ItemRow: View {
    let item: Item
    var body: some View {
        let _ = Self._printChanges()
        Text(item.title)
    }
}
```

콘솔에 `ItemRow: @self changed.` 이런 식으로 찍힌다. body가 자꾸 호출된다면 어떤 프로퍼티가 식별 비교에서 다른 걸로 보이는지 추적 가능.

---

정리하면 List 스크롤 끊김이나 버벅임 이슈 잡을 때 보는 순서는 대충 이렇다.

1. ForEach `id` 안정성 (Identifiable 채택, index id 회피)
2. ForEach 안의 if 분기 → 컨테이너 감싸기 또는 filter로 빼기
3. 셀 안에서 ViewModel 생성하는 부분 없는지
4. AsyncImage → 캐싱 라이브러리로 갈아끼우기
5. body 안에 무거운 계산 → 밖으로
6. Instruments로 진짜 무거운 곳 측정

UIKit 시절 셀 reuse·prefetch를 직접 짜야 했던 거에 비하면 SwiftUI는 손이 덜 가는데, 대신 안 보이는 자동화에 함정이 좀 있다. 한 번 패턴 익히면 같은 흐름이 매번 나옴.
