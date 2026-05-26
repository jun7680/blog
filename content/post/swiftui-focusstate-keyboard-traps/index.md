+++
author = "오깅중"
title = "@FocusState로 키보드 다루기 — 자주 헷갈리는 자리들"
slug = "swiftui-focusstate-keyboard-traps"
date = "2026-05-26T13:30:00+09:00"
description = "TextField 포커스 이동·키보드 dismiss·초기 포커스 — 매번 갸우뚱하는 자리를 한 번에 정리."
categories = ["SwiftUI"]
tags = ["SwiftUI", "FocusState", "TextField", "Keyboard", "iOS17"]
image = ""
+++

`@FocusState`는 처음 쓸 때보다 두 번째, 세 번째 쓸 때 더 헷갈린다. 폼 화면 하나 짤 때마다 "이거 nil로 두면 되던가...?" 하면서 다시 검색한다. 그래서 매번 헷갈리는 자리만 한 번 정리해둔다.

## 기본 모양

필드가 여러 개면 enum으로 묶는 패턴이 가장 깔끔하다. Bool 두세 개 따로 두는 것보다 의도가 잘 읽힌다.

```swift
struct ProfileForm: View {
    enum Field: Hashable {
        case name, email, phone
    }

    @FocusState private var focus: Field?
    @State private var name = ""
    @State private var email = ""
    @State private var phone = ""

    var body: some View {
        Form {
            TextField("이름", text: $name)
                .focused($focus, equals: .name)
            TextField("이메일", text: $email)
                .focused($focus, equals: .email)
            TextField("전화번호", text: $phone)
                .focused($focus, equals: .phone)
        }
    }
}
```

`focus = .email`이면 이메일 필드로 포커스가 옮겨가고, `focus = nil`이면 키보드가 내려간다. 이 두 줄이 사실상 전부다.

## 키보드 내리기

방법이 두 갈래다.

```swift
// 1) 명시적으로 포커스 해제
focus = nil

// 2) ScrollView/List에서 드래그로 내리기 (iOS 16+)
ScrollView {
    // ...
}
.scrollDismissesKeyboard(.interactively)
```

폼 바깥을 탭했을 때 키보드를 내리고 싶다면 보통 `focus = nil`을 직접 호출하는 게 가장 확실하다. 제스처로 처리하려고 `onTapGesture`를 컨테이너에 걸면 내부 탭 이벤트를 가로채는 일이 생겨서, 차라리 toolbar에 "완료" 버튼을 두는 방식이 분쟁이 적다.

```swift
.toolbar {
    ToolbarItemGroup(placement: .keyboard) {
        Spacer()
        Button("완료") { focus = nil }
    }
}
```

## 엔터로 다음 필드 이동

`.onSubmit`에서 다음 케이스로 포커스를 옮긴다.

```swift
TextField("이름", text: $name)
    .focused($focus, equals: .name)
    .submitLabel(.next)
    .onSubmit { focus = .email }

TextField("이메일", text: $email)
    .focused($focus, equals: .email)
    .submitLabel(.next)
    .onSubmit { focus = .phone }

TextField("전화번호", text: $phone)
    .focused($focus, equals: .phone)
    .submitLabel(.done)
    .onSubmit { focus = nil }
```

`.submitLabel`은 키보드 리턴 키 라벨만 바꿀 뿐, 실제 이동 로직은 `.onSubmit` 안에서 직접 짜야 한다. 라벨만 바꾸고 동작이 따라오지 않아 한참 갸우뚱했던 적이 있다.

## 화면 진입 시 자동 포커스

검색 화면이나 코멘트 입력 화면처럼, 들어오자마자 키보드가 올라와야 자연스러운 경우가 있다. `onAppear`에서 바로 할당하면 안 먹을 때가 있다.

```swift
.onAppear {
    focus = .search   // 가끔 무시된다
}
```

뷰 트랜지션·키보드 애니메이션과 타이밍이 겹치면 포커스 할당이 무시되는 자리가 있다. 한 틱 뒤로 미루면 안정적으로 먹는다.

```swift
.onAppear {
    Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(50))
        focus = .search
    }
}
```

`50ms`는 경험적 수치다. 더 깔끔한 정답은 없을까 싶어 한참 찾아봤는데, 공식적으로 보장된 시점 신호는 못 찾았다. 아는 분 있으면 알려주시면 감사하겠습니다.

## 한 가지 더

`@FocusState`는 **뷰 단위**라는 점이 가끔 발목을 잡는다. ViewModel에 들고 있으려고 하면 `@FocusState`는 프로퍼티 래퍼 특성상 View 안에서만 살아 있어서, ViewModel에 옮기려면 `Bool`이나 enum 값을 `@Published`로 두고 View에서 `.bind`해서 다리를 놓는 식으로 풀어야 한다. 작은 폼이면 그냥 View 안에 두는 게 결국 제일 단순하다.

키보드 처리는 별것 아닌데 매번 검색하게 되는 영역이라, 다음에 또 헷갈릴 나를 위해 정리해둔다.
