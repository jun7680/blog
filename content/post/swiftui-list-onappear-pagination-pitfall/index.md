+++
author = "오깅중"
title = "SwiftUI List에서 onAppear로 페이지네이션 짜다가..."
slug = "swiftui-list-onappear-pagination-pitfall"
date = "2026-05-21T15:35:57+09:00"
description = "SwiftUI List row의 onAppear에서 곧바로 페이지네이션 API를 호출했다가 동시·중복 호출이 폭주했고 마지막 row 판별 + isLoading guard + cursor 세 개로 정리한 기록"
categories = ["SwiftUI"]
tags = ["SwiftUI", "List", "Pagination", "iOS17"]
+++

`onAppear`라는 이름을 처음 봤을 때 UIKit `viewDidAppear` 비슷한 거라고 생각했다. 화면이 나타날 때 한 번 부르는 진입 이벤트라고 본 거다.

근데 `List` row의 `onAppear`는 그렇게 한 번만 부르고 끝나는 시그널이 아니라서 거기에 페이지네이션 API를 그대로 매달면 첫 진입에 보이는 row 수만큼 동시 호출이 나가고 스크롤을 위아래로 왔다 갔다 하면 같은 row의 `onAppear`가 또 호출되면서 API가 그대로 또 나간다. 처음엔 서버 로그를 보고 한참 헷갈렸다.

## 많이 실수하는 코드

처음 짜면 대개 이런 모양이 나온다.

```swift
struct FeedView: View {
    @State private var items: [Item] = []

    var body: some View {
        List(items) { item in
            ItemRow(item: item)
                .onAppear {
                    Task {
                        let next = await fetchNextPage()
                        items.append(contentsOf: next)
                    }
                }
        }
    }
}
```

겉으로는 "row가 나타날 때 다음 페이지 가져오기" 정도로 보이는데 막상 돌려보면 다음 같은 일이 일어난다.

- 첫 진입 시 화면에 보이는 row가 10개라면 `fetchNextPage`가 거의 동시에 10번 호출된다
- 스크롤을 내렸다가 위로 다시 올리면 위쪽 row들의 `onAppear`가 다시 불려서 또 호출된다
- 응답 순서도 보장이 안 돼서 `items`에 같은 페이지가 두 번 붙거나 순서가 섞이기도 한다
- 다음 페이지가 없어도(`cursor == nil`) 트리거가 멈추질 않는다

## 왜 문제

`List` / `ForEach` row의 `onAppear`는 한 번만 호출되는 진입 이벤트가 아니라 "지금 이 row가 그려질 차례다"에 가까운 시그널이라서 초기 진입 시 보이는 row 수만큼 호출되고 그 뒤로도 스크롤·재구성 흐름을 따라 같은 row의 `onAppear`가 반복해서 호출된다.

여기에 "API를 호출하는 함수"를 그대로 매달면 호출 횟수를 통제하는 모든 책임이 사라진 채로 동시·중복 호출이 줄줄이 나간다. 핵심은 이거다.

> `onAppear`는 "row가 보일 때마다 부르는 시그널"이지 "데이터가 끝났다고 알려주는 알림"이 아니다

그러니까 페이지네이션 트리거는 `onAppear` 자체가 아니라 그 위에서 한 번 더 걸러줘야 안정적이다.

## 해결

세 개를 묶는다.

1. **마지막 row일 때만** fetch 시도 (`last.id == currentItem.id`)
2. **`isLoading` guard** (같은 row가 또 보여도 진행 중이면 무시)
3. **`nextCursor` 체크** (더 가져올 게 없으면 호출 자체 X)

```swift
struct FeedView: View {
    @State private var items: [Item] = []
    @State private var isLoading = false
    @State private var nextCursor: String? = "first"

    var body: some View {
        List {
            ForEach(items) { item in
                ItemRow(item: item)
                    .onAppear {
                        loadMoreIfNeeded(currentItem: item)
                    }
            }
        }
        .task {
            await loadFirstPageIfNeeded()
        }
    }

    private func loadMoreIfNeeded(currentItem: Item) {
        guard !isLoading else { return }
        guard let cursor = nextCursor else { return }
        guard let last = items.last, last.id == currentItem.id else { return }

        isLoading = true
        Task {
            defer { isLoading = false }
            let page = await fetchPage(after: cursor)
            items.append(contentsOf: page.items)
            nextCursor = page.nextCursor
        }
    }

    private func loadFirstPageIfNeeded() async {
        guard items.isEmpty, !isLoading else { return }
        // 초기 로드
    }
}
```

세 guard가 함께 걸려야 의미가 있다. 마지막 row 판별 하나만 두면 첫 진입에는 트리거 한 번만 들어가서 괜찮지만 사용자가 마지막 row 근처에서 스크롤을 살짝씩 흔들면 같은 지점에서 또 호출되고 `isLoading`만 두면 중복은 막아도 다음 페이지가 없어진 뒤에도 계속 시도가 들어가고 cursor만 두면 동시 호출은 못 막는다.

초기 로드는 `onAppear` 대신 `.task`로 분리한다. `.task`는 View life cycle에 묶여서 한 번만 실행되고 화면이 사라지면 같이 취소되니까 초기 로드처럼 "한 번만 부르고 싶은 비동기"에 시맨틱이 잘 맞는다.

## 회고

`onAppear`라는 이름이 직관적이긴 한데 "row가 한 번 나타났다"라는 사실이 아니라 "지금 그려진다"라는 그 순간을 알려주는 거라서 view 한 개당 여러 번 부르는 게 자연스러운 시그널이다. 페이지네이션처럼 "한 번에 한 요청"이라는 책임을 거기 직접 매달면 거의 매번 폭주한다.

페이지네이션 트리거는 `onAppear` 위에 한 겹 더 얹어서 마지막 row + loading + cursor 셋이 함께 통과할 때만 실제 API가 나가도록 묶어두는 게 결국 답이었다.
