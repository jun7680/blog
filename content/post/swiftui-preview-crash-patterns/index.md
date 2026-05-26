+++
author = "오깅중"
title = "SwiftUI #Preview가 자꾸 죽을 때 점검할 패턴들"
slug = "swiftui-preview-crash-patterns"
date = "2026-05-26T14:00:00+09:00"
description = "Environment·SwiftData 컨테이너만 챙겨도 Preview crash 대부분이 사라진다."
categories = ["SwiftUI"]
tags = ["SwiftUI", "Preview", "Xcode", "SwiftData", "iOS17"]
image = ""
+++

`#Preview` 매크로(iOS 17+)로 옮긴 뒤로 캔버스가 빨갛게 죽는 빈도가 늘었다. 대부분 뷰 코드가 잘못된 게 아니라 **Preview에 환경(Environment)이나 의존성을 안 넘겨서** 터지는 거였다. 매번 같은 패턴을 까먹고 헤매서 정리해 둔다.

## 1. SwiftData `@Model`을 컨테이너 없이 만들면 즉사

가장 자주 만나는 케이스다. `@Model` 인스턴스는 `ModelContainer` 컨텍스트 안에서만 살 수 있어서, Preview에서 그냥 `Item(...)` 만들어 넣으면 바로 crash 한다.

```swift
// 죽는 코드
#Preview {
    ItemRow(item: Item(title: "샘플"))   // ModelContainer 없음 → crash
}
```

in-memory 컨테이너를 띄우고 그 안에서 인스턴스를 만들어 주입한다.

```swift
#Preview {
    let config = ModelConfiguration(isStoredInMemoryOnly: true)
    let container = try! ModelContainer(for: Item.self, configurations: config)

    let sample = Item(title: "샘플")
    container.mainContext.insert(sample)

    return ItemRow(item: sample)
        .modelContainer(container)
}
```

`isStoredInMemoryOnly: true`면 디스크에 안 쌓이니까 Preview 돌릴 때마다 더러워질 일도 없다.

## 2. `@Environment(\.modelContext)` 쓰는 뷰는 컨테이너 modifier 필수

뷰 내부에서 `@Environment(\.modelContext) private var context`로 꺼내 쓰는 경우, Preview 루트에 `.modelContainer(...)`가 안 붙어 있으면 context를 못 찾고 터진다. 위 예제처럼 컨테이너만 한 번 달아 주면 끝.

리스트성 뷰처럼 `@Query`로 데이터를 가져오는 경우도 같다. 컨테이너 없으면 Query 자체가 죽는다.

## 3. NavigationStack / 상위 뷰 누락

`NavigationLink`, `.navigationTitle`, `.toolbar` 같은 modifier가 들어간 뷰를 그냥 띄우면 동작은 하지만 레이아웃이 깨지거나, 일부 modifier가 캔버스에서 빈 화면을 만든다. 디버깅 시간 줄이려면 처음부터 감싸 두는 게 편하다.

```swift
#Preview {
    NavigationStack {
        DetailView(id: "preview-001")
    }
}
```

탭 단에서 동작하는 뷰면 `TabView`까지 한 번 더 감싸면 실 화면과 비슷해진다.

## 4. `@MainActor` 격리 위반

Preview 클로저 안에서 `@MainActor`로 격리된 ViewModel을 비격리 컨텍스트에서 초기화하면 컴파일은 통과해도 런타임에 죽거나 경고가 뜬다. iOS 17+ 매크로는 클로저가 메인 액터로 추론되지만, 클래스 초기화나 비동기 호출을 섞으면 깨진다.

ViewModel 자체를 `@MainActor`로 선언하고, 필요한 작업은 `Task { @MainActor in ... }`로 명시한다.

```swift
@MainActor
final class DetailViewModel: ObservableObject {
    @Published var items: [Item] = []
}

#Preview {
    DetailView(viewModel: DetailViewModel())   // 클로저가 MainActor라 OK
}
```

## 5. 외부 의존성은 mock으로 갈아끼우기

네트워크 클라이언트나 위치 매니저처럼 실기기에서만 살아나는 의존성을 그대로 넘기면 Preview에서 무한 로딩이거나 권한 요청 단계에서 죽는다. 프로토콜로 추상화해 두고 Preview용 mock 구현을 주입하는 게 가장 안전하다.

```swift
protocol ItemFetching {
    func fetch() async throws -> [Item]
}

struct PreviewItemFetcher: ItemFetching {
    func fetch() async throws -> [Item] {
        [Item(title: "샘플1"), Item(title: "샘플2")]
    }
}

#Preview {
    ItemListView(fetcher: PreviewItemFetcher())
}
```

## 정리

체크리스트로 쓰기 좋게 한 번 더.

- SwiftData 뷰 → `.modelContainer(for: Item.self, inMemory: true)` 붙였나
- `@Query` / `@Environment(\.modelContext)` 쓰는 뷰 → 위와 동일
- Navigation modifier 쓰는 뷰 → `NavigationStack`으로 감쌌나
- `@MainActor` ViewModel → 격리 일치하는지
- 네트워크·센서 의존성 → mock 주입했나

이 다섯 개만 의식해도 캔버스 빨갛게 보는 일이 확 줄어든다. Preview는 결국 작은 앱이라, 실행 환경을 똑같이 만들어 줘야 산다는 점만 기억하면 된다.
