+++
author = "오깅중"
title = "SwiftUI searchable 붙이고 검색 상태가 지저분해졌을 때"
slug = "swiftui-searchable-state-management"
date = "2026-06-01T16:25:00+09:00"
description = "SwiftUI searchable에서 입력 중인 searchText, 실제 API query, 검색 결과 상태를 한 값에 묶었다가 꼬인 경험과 상태를 나눠 정리한 패턴."
categories = ["SwiftUI"]
tags = ["SwiftUI", "searchable", "Search", "NavigationStack", "iOS15"]
image = "thumbnail.png"
+++

SwiftUI에서 검색창 붙이는 건 쉽다. `NavigationStack`이나 `List`에 `.searchable(text:)` 한 줄 붙이면 검색 필드가 바로 생긴다.

문제는 그 다음이다. 검색어가 바뀔 때마다 API를 부르고, 검색 결과 없음 화면도 보여주고, 추천어도 띄우고, 화면을 나갔다 돌아왔을 때 이전 검색어를 유지할지 말지까지 들어오면 `@State var searchText` 하나가 갑자기 너무 많은 일을 하기 시작한다.

나는 처음에 `searchText` 하나로 입력값, API 요청값, 화면 상태를 전부 처리했다가 코드가 꽤 지저분해졌다. 정리하고 보니 핵심은 단순했다. **사용자가 입력 중인 값과 실제 검색에 사용한 값은 분리하는 게 낫다.**

## 처음에는 한 값으로 다 처리한다

처음 떠오르는 코드는 보통 이렇다.

```swift
struct ProductSearchView: View {
    @State private var searchText = ""
    @State private var results: [Product] = []
    @State private var isLoading = false

    var body: some View {
        List(results) { product in
            ProductRow(product: product)
        }
        .searchable(text: $searchText, prompt: "상품 검색")
        .onChange(of: searchText) { _, newValue in
            Task {
                isLoading = true
                results = try await ProductAPI.search(keyword: newValue)
                isLoading = false
            }
        }
    }
}
```

짧긴 한데 문제가 많다.

- 한 글자 입력할 때마다 요청이 나간다.
- `a`, `ap`, `app` 요청 순서가 뒤섞이면 오래 걸린 응답이 나중에 와서 최신 결과를 덮을 수 있다.
- 빈 문자열이 들어왔을 때 추천 목록을 보여줄지, 전체 목록을 보여줄지, 아무것도 안 보여줄지 기준이 애매하다.
- 검색창에 보이는 값과 서버에 보낸 값이 항상 같다고 가정한다.

Apple 문서에서 [`searchable(text:placement:prompt:)`](https://developer.apple.com/documentation/swiftui/view/searchable%28text%3Aplacement%3Aprompt%3A%29)는 검색 필드에 표시하고 편집할 텍스트 binding을 받는다. 즉 이 값은 우선 **검색창의 입력 상태**다. API 요청 상태까지 같은 값에 억지로 묶을 필요는 없다.

## 입력값과 커밋된 검색어를 나눈다

나는 검색 화면에서 보통 값을 세 개로 나눈다.

```swift
@State private var searchText = ""       // 사용자가 지금 입력 중인 값
@State private var committedQuery = ""   // 실제 검색에 사용한 값
@State private var results: [Product] = []
```

`searchText`는 UI 입력값이고, `committedQuery`는 앱이 믿고 검색한 값이다. 공백 정리, 최소 글자 수, debounce 같은 정책은 둘 사이에서 처리한다.

```swift
struct ProductSearchView: View {
    @State private var searchText = ""
    @State private var committedQuery = ""
    @State private var results: [Product] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            if isLoading {
                ProgressView()
            } else if committedQuery.isEmpty {
                RecentSearchSection()
            } else if results.isEmpty {
                ContentUnavailableView.search(text: committedQuery)
            } else {
                ForEach(results) { product in
                    ProductRow(product: product)
                }
            }
        }
        .searchable(text: $searchText, prompt: "상품 검색")
        .task(id: searchText) {
            await searchIfNeeded(searchText)
        }
    }

    private func searchIfNeeded(_ text: String) async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)

        guard query.count >= 2 else {
            committedQuery = ""
            results = []
            return
        }

        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        guard query != committedQuery else { return }

        committedQuery = query
        isLoading = true
        errorMessage = nil

        do {
            results = try await ProductAPI.search(keyword: query)
        } catch {
            errorMessage = "검색 결과를 불러오지 못했어요."
            results = []
        }

        isLoading = false
    }
}
```

이 패턴의 장점은 `searchText`를 직접 다듬지 않는다는 점이다. 사용자가 입력 중인 텍스트는 그대로 두고, 실제 검색어만 정리해서 쓴다. 한글 조합 중에 입력값을 건드려 커서가 튀는 일도 줄어든다.

## `.task(id:)`를 쓰면 이전 검색이 자연스럽게 취소된다

검색어가 바뀔 때마다 직접 `Task`를 만들고 저장해두는 방식도 가능하다.

```swift
@State private var searchTask: Task<Void, Never>?

.onChange(of: searchText) { _, newValue in
    searchTask?.cancel()
    searchTask = Task {
        try? await Task.sleep(for: .milliseconds(300))
        await search(newValue)
    }
}
```

근데 SwiftUI에서는 `.task(id:)`가 더 읽기 편했다.

```swift
.task(id: searchText) {
    await searchIfNeeded(searchText)
}
```

`id`가 바뀌면 이전 task는 취소되고 새 task가 시작된다. debounce용 `Task.sleep`도 취소가 먹기 때문에 따로 타이머 state를 들고 다닐 필요가 없다.

다만 `.task(id:)` 안에서 검색 결과를 state에 반영한다면, 취소 이후 응답이 화면을 덮지 않도록 `Task.isCancelled`를 확인하는 습관은 남겨두는 게 좋다.

```swift
let response = try await ProductAPI.search(keyword: query)
guard !Task.isCancelled else { return }
results = response
```

## 검색 결과 없음과 검색 전 화면은 다르다

검색 화면에서 자주 섞이는 상태가 있다.

| 상태 | 의미 |
|---|---|
| `searchText.isEmpty` | 사용자가 검색창에 아무것도 입력하지 않음 |
| `committedQuery.isEmpty` | 앱이 아직 검색을 실행하지 않음 |
| `results.isEmpty` | 검색은 했지만 결과가 없음 |

이 셋을 전부 `results.isEmpty` 하나로 보면 화면이 이상해진다. 아직 검색 전인데 "검색 결과 없음"이 뜨거나, 한 글자만 입력했는데 이전 결과가 사라지거나, 빈 검색어에서 전체 목록 API를 때리는 식이다.

나는 보통 이렇게 나눈다.

```swift
if committedQuery.isEmpty {
    RecentSearchSection()
} else if isLoading {
    ProgressView()
} else if results.isEmpty {
    ContentUnavailableView.search(text: committedQuery)
} else {
    ResultList(results: results)
}
```

검색 전 화면은 최근 검색어나 추천어가 어울리고, 검색 결과 없음은 이미 실행한 query가 있어야 자연스럽다.

## 추천어는 검색 결과와 다른 데이터다

`searchSuggestions`를 붙이면 추천어도 SwiftUI 쪽에서 자연스럽게 처리할 수 있다.

```swift
.searchable(text: $searchText, prompt: "상품 검색")
.searchSuggestions {
    ForEach(suggestions) { suggestion in
        Text(suggestion.title)
            .searchCompletion(suggestion.keyword)
    }
}
```

Apple 문서의 [`searchSuggestions`](https://developer.apple.com/documentation/swiftui/view/searchsuggestions%28_%3A%29) 예제처럼 `searchCompletion(_:)`을 붙이면 제안을 눌렀을 때 검색창 텍스트가 해당 값으로 채워진다.

여기서도 결과와 추천어를 같은 배열로 합치지 않는 게 좋았다.

```swift
@State private var suggestions: [SearchSuggestion] = []
@State private var results: [Product] = []
```

추천어는 입력 보조 데이터고, 결과는 검색 실행 결과다. 둘의 빈 상태 의미가 다르다. 추천어가 없다고 결과 없음 화면을 띄우면 이상하고, 결과가 없다고 추천어 API까지 실패한 것처럼 보이면 더 이상하다.

## 내가 쓰는 기준

SwiftUI 검색 화면은 지금 이렇게 잡는다.

1. `.searchable`의 binding은 입력 상태로만 본다.
2. 공백 trim, 최소 글자 수, debounce를 거친 값을 별도 query로 둔다.
3. API 요청은 `.task(id: searchText)`나 view model의 취소 가능한 search 메서드로 보낸다.
4. 검색 전, 로딩, 결과 없음, 에러, 결과 있음 상태를 분리한다.
5. suggestions와 results는 다른 데이터로 둔다.

`searchable`은 검색창을 붙여주는 modifier이지, 검색 플로우 전체를 대신 설계해주는 API는 아니다. 검색창에 보이는 문자열 하나에 모든 의미를 얹기 시작하면 금방 꼬인다.

입력 중인 텍스트, 실제 실행한 query, 화면 상태를 나눠두면 코드는 조금 길어지지만 디버깅은 훨씬 쉬워진다. 검색 UI는 대부분 "입력은 빠르게 바뀌고, 결과는 늦게 도착한다"는 비대칭에서 꼬이기 때문에 그 경계를 코드에도 남겨두는 편이 낫다.
