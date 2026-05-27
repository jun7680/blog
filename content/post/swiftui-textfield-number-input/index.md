+++
author = "오깅중"
title = "SwiftUI TextField 숫자 입력이 자꾸 되돌아갈 때"
slug = "swiftui-textfield-number-input"
date = "2026-05-27T08:45:00+09:00"
description = "SwiftUI TextField에 Int를 바로 묶었다가 빈 입력과 검증 타이밍에서 막혔다면 String 입력 상태를 따로 두는 방법이 편하다."
categories = ["SwiftUI"]
tags = ["SwiftUI", "TextField", "FormatStyle", "Form", "iOS17"]
image = "thumbnail.png"
+++

수량이나 금액 입력칸을 만들 때 `TextField`에 `Int`를 바로 묶으면 코드가 아주 예쁘다. `format: .number`까지 붙이면 화면에 보여주는 모양도 알아서 챙겨주니 여기서 끝난 줄 알기 쉽다.

그런데 값을 다 지우고 새로 입력하려는 순간이 조금 답답하다. 사용자는 아직 숫자를 완성하는 중인데 모델은 이미 완성된 `Int`만 받고 싶어 하고, 이 둘을 같은 값 하나로 처리하면서 삐걱거리기 시작한다. SwiftUI TextField 숫자 입력을 검색하게 되는 이유도 보통 여기서 시작한다.

환경은 Xcode 26.4 / iOS 17+ 기준이다.

## 처음 떠오르는 코드는 꽤 멀쩡함

```swift
struct QuantityForm: View {
    @State private var quantity = 1

    var body: some View {
        TextField("수량", value: $quantity, format: .number)
            .keyboardType(.numberPad)
    }
}
```

이 코드가 틀린 건 아니다. 이미 유효한 숫자가 있고 사용자가 입력을 마치면 바로 모델에 넣어도 되는 폼에서는 짧고 읽기 좋다.

다만 Apple의 [`TextField` 문서](https://developer.apple.com/documentation/swiftui/textfield)는 `String` 바인딩은 타이핑하는 동안 계속 갱신되지만 숫자 같은 non-string 타입은 사용자가 편집을 확정할 때 값이 갱신된다고 설명한다. 게다가 [`value:format:` initializer 문서](https://developer.apple.com/documentation/swiftui/textfield/init%28value%3Aformat%3Aprompt%3Alabel%3A%29-99ntf)에 따르면 형식에 맞지 않는 상태로 편집을 끝내면 필드의 텍스트가 마지막 유효 값으로 돌아간다.

`12`를 지우고 `25`를 적는 동안에는 빈 문자열도 잠깐 필요하고, 붙여넣기로 `2a`가 들어오는 순간도 있을 수 있다. 입력창 입장에서는 자연스러운 중간 상태인데 `Int` 입장에서는 전부 들어올 수 없는 값이다.

## 입력하는 값과 저장하는 값의 분리

나는 이런 폼이면 입력칸은 `String`으로 받고, 사용자가 완료를 눌렀을 때 숫자로 넘기는 쪽이 읽기 편하다. 모델은 유효한 숫자만 들고 있고 입력창은 아직 덜 입력된 문자열을 억지로 숨기지 않아도 된다.

```swift
struct QuantityEditor: View {
    @Binding var quantity: Int

    @State private var draftText: String
    @State private var validationMessage: String?
    @FocusState private var isFocused: Bool

    init(quantity: Binding<Int>) {
        _quantity = quantity
        _draftText = State(initialValue: String(quantity.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("수량", text: $draftText)
                .keyboardType(.numberPad)
                .focused($isFocused)

            if let validationMessage {
                Text(validationMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("완료") {
                    commit()
                    isFocused = false
                }
            }
        }
        .onChange(of: isFocused) { _, focused in
            if !focused {
                commit()
            }
        }
    }

    private func commit() {
        let trimmed = draftText.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let value = Int(trimmed), (1...99).contains(value) else {
            validationMessage = "1부터 99까지 숫자로 입력해 주세요."
            return
        }

        quantity = value
        draftText = String(value)
        validationMessage = nil
    }
}
```

여기서는 입력 중인 `draftText`를 그대로 보여준다. 비어 있어도 되고 아직 검증을 통과하지 않았어도 된다. 대신 `quantity`에는 `commit()`을 통과한 값만 들어가므로 화면 밖에서 이 값을 쓰는 코드는 매번 optional이나 이상한 임시 값을 신경 쓰지 않아도 된다.

숫자 패드에는 Return 키가 없어서 키보드 위에 `완료` 버튼을 올렸다. 사용자가 화면의 다른 필드로 이동하는 경우까지 놓치지 않으려고 focus가 빠지는 시점에도 같은 `commit()`을 부르게 해뒀다.

## 숫자 키보드는 검증 로직이 아님

`.keyboardType(.numberPad)`를 붙이면 숫자만 들어올 것처럼 보이지만, 이건 입력하기 편한 키보드를 요청하는 설정이다. 외부 키보드나 붙여넣기까지 생각하면 문자열이 정말 숫자인지는 여전히 코드에서 확인해야 한다.

그리고 모든 입력창을 이렇게 나눌 필요도 없다. 잘못된 입력이면 이전 값으로 복원돼도 괜찮고, 저장 버튼을 따로 둘 필요가 없는 간단한 필드라면 `value:format:` 방식이 훨씬 간결하다. 반대로 빈 값이 잠깐이라도 자연스럽거나 입력 오류를 바로 보여줘야 한다면 `String` 입력 상태를 따로 두는 쪽이 덜 답답하다.

처음엔 숫자인데 굳이 문자열을 하나 더 들고 있어야 하나 싶었는데, 생각을 바꾸니 단순했다. 사용자가 편집하고 있는 텍스트와 앱이 믿고 쓰는 숫자는 같은 순간에 같은 값일 필요가 없다. 그 경계만 분리해두면 TextField가 갑자기 고집을 부리는 것처럼 보이는 일도 줄어든다.
