+++
author = "오깅중"
title = "SwiftUI onChange 안에서 state 다시 set하면 무한 루프 돈다"
slug = "swiftui-onchange-infinite-loop"
date = "2026-05-21T13:33:28+09:00"
description = "SwiftUI onChange 안에서 감시 중인 state를 다시 set하면 어떻게 무한 호출이 도는지 어떤 식으로 끊었는지 정리한 글"
categories = ["SwiftUI"]
tags = ["SwiftUI", "onChange", "State", "iOS17"]
+++

SwiftUI `onChange`를 처음 봤을 때 그냥 "값 바뀌면 호출되는 이벤트 핸들러"라고 생각했다. UIKit `addTarget(_:action:for: .editingChanged)` 같은 거라고 본 거다.

근데 그렇게 쓰다 보면 어느 순간 콘솔이 미친 듯이 찍히고 운 나쁘면 CPU 한 코어가 그대로 먹힌다. 원인은 거의 매번 같은데 `onChange` 안에서 감시 중인 state를 다시 건드렸기 때문이다.

이 글은 그걸 한 번 제대로 정리해두려고 쓴다.

## 많이 실수하는 코드

검색 화면에서 사용자가 친 공백을 자동으로 다듬어 주고 싶었다고 치자. 가장 손이 빠른 코드는 보통 이렇게 나온다.

```swift
struct SearchView: View {
    @State private var query: String = ""

    var body: some View {
        TextField("검색어", text: $query)
            .onChange(of: query) { _, newValue in
                let cleaned = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                if query != cleaned {
                    query = cleaned // ← 여기
                }
            }
    }
}
```

겉으로는 "공백 들어왔을 때만 한 번 다듬는다" 정도로 보이는데 실제로 돌려보면 입력하다가 갑자기 무거워지고 운 나쁘면 콘솔 로그가 무한히 흐른다.

## 왜 문제

`onChange`는 이름이 핸들러처럼 생겼지만 SwiftUI 입장에서 보면 그냥 **state 변경 흐름의 일부**다.

`query`가 바뀌면 SwiftUI가 body를 다시 평가하고 그 과정에서 `onChange` 클로저가 호출되는데 그 안에서 또 `query = cleaned`를 하니까 그것도 state 변경이라서 SwiftUI는 또 그걸 처리한다. `if query != cleaned` 가드를 넣어둬도 입력값이 계속 변하면 가드가 안 먹는 케이스가 충분히 생긴다.

핵심은 이거다.

> `onChange`에서 감시 중인 state를 다시 set하면 그 set이 또 `onChange`를 부른다

UIKit 핸들러는 "이벤트가 발생했다"는 사실에 매달려 있는 반면 SwiftUI `onChange`는 "이 값이 어떤 값이다"라는 상태에 매달려 있다. 같은 자리에서 같은 값을 다시 쓰는 행위가 UIKit에선 그냥 setter 호출이지만 SwiftUI에선 잠재적인 트리거가 되는 거다.

## 해결책 1 — 가드 한 줄짜리 임시 처방

당장 멈춰야 할 때 제일 쉬운 건 그냥 가드 한 줄.

```swift
.onChange(of: query) { _, newValue in
    let cleaned = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleaned != newValue else { return }
    query = cleaned
}
```

`cleaned == newValue`면 다듬을 게 없다는 뜻이니까 set 자체를 건너뛰면서 루프는 일단 멈춘다.

다만 이건 진짜 임시 처방인데 입력값이랑 표시값을 같은 state로 들고 있는 구조 자체가 안 좋아서 다음 사람이 이 코드를 보면 "왜 onChange에서 자기 자신을 다시 set하지" 부터 헷갈리고 옆에 분기가 한 줄만 더 붙어도 다시 무너진다.

## 해결책 2 — 입력 state와 파생 state 분리

좀 더 구조적으로 풀려면 입력 그대로의 값과 정규화된 값을 분리하는 쪽이 낫다.

```swift
struct SearchView: View {
    @State private var rawInput: String = ""
    @State private var normalizedQuery: String = ""

    var body: some View {
        TextField("검색어", text: $rawInput)
            .onChange(of: rawInput) { _, newValue in
                normalizedQuery = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            }
    }
}
```

`onChange`가 보는 건 `rawInput`인데 안에서 set하는 건 `normalizedQuery`라서 둘이 다른 state라 자기 자신을 다시 부를 일이 없다.

사용자가 보는 입력은 그대로 두면서 (한글 조합 중에 공백 다듬어서 커서 튀는 사고도 같이 사라진다) 검색 로직은 `normalizedQuery`만 보면 되니까 흐름이 깔끔해진다. 대부분의 "onChange 안에서 같은 state 만지고 있네" 케이스는 이쪽으로 풀면 답이 나온다.

## 해결책 3 — 비동기·debounce가 얽힐 때는 `.task(id:)`

검색 키워드처럼 입력이 바뀔 때마다 네트워크 요청이 따라가야 하면 얘기가 더 복잡해진다.

`onChange`에서 직접 `Task`를 띄우면 debounce용 타이머 state도 들어오고 진행 중 task 핸들도 들어오고 취소 처리도 같이 들어와서 `onChange`가 보게 되는 state가 한꺼번에 늘어나는데 그러다 보면 또 어디선가 자기 자신을 건드리고 있게 된다.

이 자리에는 `.task(id:)`가 시맨틱이 가장 잘 맞는다.

```swift
struct SearchView: View {
    @State private var rawInput: String = ""
    @State private var results: [String] = []

    var body: some View {
        TextField("검색어", text: $rawInput)
            .task(id: rawInput) {
                try? await Task.sleep(for: .milliseconds(300)) // debounce
                if Task.isCancelled { return }
                let normalized = rawInput.trimmingCharacters(in: .whitespacesAndNewlines)
                results = await search(normalized)
            }
    }

    func search(_ q: String) async -> [String] { /* ... */ [] }
}
```

`rawInput`이 바뀔 때마다 이전 task는 자동으로 취소되고 새 task가 뜨는 구조다. debounce용 sleep도 task 취소가 그대로 먹히니까 따로 타이머를 들고 다닐 필요 없고 `Task.isCancelled` 한 번만 봐주면 끝.

`onChange`로 같은 동작을 짜려고 하면 코드가 두 배는 늘어나는데 `.task(id:)`는 SwiftUI가 화면 생명주기랑 task 생명주기를 알아서 묶어주니까 손이 한참 줄어든다.

## iOS 17 onChange 시그니처 짧게

위에 코드는 다 새 시그니처(`(oldValue, newValue) in`)로 썼는데 iOS 16 끌고 가는 프로젝트면 시그니처가 다르다.

```swift
// iOS 16 이하
.onChange(of: query) { newValue in
    // oldValue 못 받음
}

// iOS 17+
.onChange(of: query) { oldValue, newValue in
    // oldValue 받을 수 있음
}

// iOS 17+, 화면 뜨자마자 한 번 실행시키고 싶으면
.onChange(of: query, initial: true) { oldValue, newValue in
    // ...
}
```

`initial: true`는 첫 진입 때 한 번 더 부르는 옵션이라 편하긴 한데 안 그래도 자기 자신 set 위험이 있는 클로저면 이걸 켜는 순간 더 빨리 터지니까 켤 거면 그 안의 set 동선을 먼저 정리하고 켜는 게 안전하다.

## 회고

`onChange`는 진짜 "이름이 너무 핸들러 같이 생긴 게" 문제의 절반인 것 같다. 이름만 보고 UIKit `addTarget` 비슷한 거라고 생각하면 안에서 자기 자신을 막 만지게 되는데 SwiftUI는 "이벤트 발생"이 아니라 "값이 어떤 값이다"를 보고 동작하는 시스템이라서 `onChange`도 그 흐름 안에 같이 들어가 있다.

요즘은 글을 쓸 때 "이거 onChange로 풀어도 되나"를 한 번 더 생각하는데 안에서 같은 state를 만질 것 같으면 거의 매번 답은 셋 중 하나다.

- 그냥 가드 (임시)
- 입력/파생 state 분리 (대부분 정답)
- `.task(id:)`로 옮기기 (비동기 얽힐 때)

`onChange`는 "다른 곳에 부수 효과만 흘리는" 자리에만 쓰고 안에서 자기 state는 안 만지는 게 가장 안전하다.
