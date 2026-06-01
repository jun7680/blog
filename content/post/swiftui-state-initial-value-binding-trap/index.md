+++
author = "오깅중"
title = "SwiftUI @State 초기값이 바인딩을 따라 바뀌지 않을 때"
slug = "swiftui-state-initial-value-binding-trap"
date = "2026-06-02T07:20:00+09:00"
description = "SwiftUI View init에서 @State를 Binding 값으로 초기화했다가 부모 값 변경을 놓친 경험과 draft state, onChange, id 재생성 기준을 정리한다."
categories = ["SwiftUI"]
tags = ["SwiftUI", "State", "Binding", "ViewLifecycle", "iOS17"]
image = "thumbnail.png"
+++

SwiftUI에서 편집 화면을 만들다 보면 부모가 넘겨준 모델을 `@State`에 복사해서 쓰고 싶을 때가 있다. 예를 들어 상세 화면에서 이름을 수정하다가 저장 버튼을 누를 때만 실제 모델에 반영하는 구조다.

처음에는 `init`에서 바인딩 값을 읽어 `@State` 초기값으로 넣으면 끝난 줄 알았다. 그런데 부모가 다른 아이템을 넘겨도 편집 화면의 값이 그대로 남아 있거나, 리스트에서 행을 바꿨는데 이전 draft가 보이는 일이 생겼다.

정리하고 보니 문제는 단순했다. **`@State`의 초기값은 View가 처음 살아날 때 쓰이는 값이지, 부모 값이 바뀔 때마다 다시 동기화되는 값이 아니다.**

## 처음에 작성한 코드

편집 화면은 보통 이런 식으로 시작한다.

```swift
struct ProfileEditor: View {
    @Binding var profile: Profile
    @State private var name: String

    init(profile: Binding<Profile>) {
        _profile = profile
        _name = State(initialValue: profile.wrappedValue.name)
    }

    var body: some View {
        Form {
            TextField("이름", text: $name)

            Button("저장") {
                profile.name = name
            }
        }
    }
}
```

코드만 보면 자연스럽다. `profile.name`을 바로 수정하지 않고, 사용자가 입력 중인 `name`을 따로 둔 뒤 저장할 때만 반영한다. 취소 버튼이 있는 화면에서는 이 구조가 필요하다.

문제는 같은 `ProfileEditor` 자리에 다른 `profile`이 들어오는 경우다. SwiftUI는 `body`를 다시 계산하지만, 기존 View identity가 유지되면 `@State` 저장소도 유지된다. 그래서 `init` 코드가 다시 보인다고 해서 state가 항상 새로 시작한다고 생각하면 안 된다.

Apple 문서의 [`State`](https://developer.apple.com/documentation/swiftui/state)는 SwiftUI가 값을 관리하고, view가 다시 그려져도 값을 유지한다고 설명한다. 이 유지가 장점이지만, 부모 값을 복사한 draft에서는 함정이 된다.

## `@State`는 입력 draft로 쓰는 값이다

나는 이 상황을 이렇게 나눠서 본다.

| 값 | 역할 |
|---|---|
| `@Binding var profile` | 부모가 소유한 원본 값 |
| `@State var name` | 현재 화면에서 편집 중인 임시 값 |
| `save()` | draft를 원본에 반영하는 경계 |

즉 `name`은 `profile.name`의 실시간 mirror가 아니다. 사용자가 편집 중인 독립 draft다. 원본이 바뀔 때 draft도 무조건 바꿔야 하는지, 아니면 사용자의 미저장 입력을 보호해야 하는지 먼저 정해야 한다.

예를 들어 화면 밖에서 서버 갱신이 들어왔다고 해서 사용자가 입력 중인 텍스트를 갑자기 덮어쓰면 더 위험할 수 있다. 반대로 리스트에서 다른 프로필을 선택한 경우라면 draft를 새 프로필 값으로 바꾸는 게 맞다.

## 선택 대상이 바뀌면 명시적으로 동기화한다

선택된 모델의 `id`가 바뀔 때 draft를 다시 채워야 한다면 `onChange`를 명시적으로 둔다.

```swift
struct ProfileEditor: View {
    @Binding var profile: Profile
    @State private var name: String
    @State private var bio: String

    init(profile: Binding<Profile>) {
        _profile = profile
        let value = profile.wrappedValue
        _name = State(initialValue: value.name)
        _bio = State(initialValue: value.bio)
    }

    var body: some View {
        Form {
            TextField("이름", text: $name)
            TextEditor(text: $bio)

            Button("저장") {
                save()
            }
        }
        .onChange(of: profile.id) { _, _ in
            resetDraft(from: profile)
        }
    }

    private func resetDraft(from profile: Profile) {
        name = profile.name
        bio = profile.bio
    }

    private func save() {
        profile.name = name
        profile.bio = bio
    }
}
```

여기서는 `profile.id` 변경만 동기화 기준으로 삼았다. 같은 프로필의 서버 값이 갱신될 때마다 draft를 덮어쓰지는 않겠다는 뜻이다. 이 기준을 코드로 드러내면 나중에 "왜 값이 안 따라오지?"보다 "어떤 변경을 따라가야 하지?"로 문제를 볼 수 있다.

## `.id()`로 View를 새로 만들 수도 있다

부모 쪽에서 선택 대상이 바뀔 때 편집 화면 전체를 새로 시작하게 만들 수도 있다.

```swift
ProfileEditor(profile: $selectedProfile)
    .id(selectedProfile.id)
```

이렇게 하면 `selectedProfile.id`가 바뀔 때 View identity가 바뀌고, 하위의 `@State`도 새로 초기화된다. 편집 화면 안에 여러 draft state, focus state, validation state가 같이 묶여 있다면 이 방식이 더 깔끔할 때가 있다.

다만 `.id()`는 꽤 강한 도구다. 화면 내부 상태를 전부 버린다. 스크롤 위치, focus, 애니메이션 상태까지 새로 시작할 수 있으니 "선택 대상 변경 시 편집 세션을 완전히 리셋한다"는 의도가 맞을 때만 쓴다.

## 바인딩을 그대로 넘기는 게 나은 경우

취소가 필요 없고 입력 즉시 원본에 반영해도 된다면 draft state를 만들 필요가 없다.

```swift
struct ProfileNameField: View {
    @Binding var name: String

    var body: some View {
        TextField("이름", text: $name)
    }
}
```

이런 컴포넌트에서 괜히 `@State private var draftName`을 만들면 오히려 동기화 문제가 생긴다. 컴포넌트가 단순한 입력 필드인지, 저장/취소 경계가 있는 편집 세션인지가 기준이다.

나는 이렇게 나눈다.

- 입력 즉시 반영: `@Binding`을 직접 사용
- 저장 버튼이 있음: `@State` draft를 만들고 저장 시 반영
- 선택 대상 변경 시 draft 리셋: `onChange(of: id)` 또는 `.id(id)`
- 외부 갱신과 사용자 입력이 충돌 가능: 자동 덮어쓰기 금지, 충돌 UI 고려

## ViewModel로 옮겨도 같은 문제는 남는다

`ObservableObject`나 `@Observable` view model로 옮기면 코드가 정리될 수는 있다. 하지만 원본 값을 draft로 복사하는 순간, 같은 질문은 남는다.

```swift
@Observable
final class ProfileEditorModel {
    var name: String
    var bio: String

    private var sourceID: Profile.ID

    init(profile: Profile) {
        sourceID = profile.id
        name = profile.name
        bio = profile.bio
    }

    func resetIfNeeded(profile: Profile) {
        guard sourceID != profile.id else { return }
        sourceID = profile.id
        name = profile.name
        bio = profile.bio
    }
}
```

저장소가 `@State`든 view model이든 핵심은 같다. draft를 언제 만들고, 언제 버리고, 언제 원본에 반영할지 기준이 있어야 한다.

## 내가 잡은 기준

지금은 `@State`를 부모 값으로 초기화할 때마다 아래를 먼저 확인한다.

1. 이 값은 원본의 mirror인가, 편집 중인 draft인가?
2. 사용자가 입력 중일 때 외부 변경이 들어오면 덮어써도 되는가?
3. 어떤 key가 바뀌면 draft를 리셋해야 하는가?
4. 리셋 범위가 필드 몇 개인가, 화면 전체인가?
5. 취소 버튼이 없다면 애초에 `@Binding` 직접 수정이 더 단순하지 않은가?

`@State(initialValue:)` 자체가 나쁜 건 아니다. 다만 이 코드는 "처음 한 번 draft를 만든다"는 의미에 가깝다. 부모 값 변경을 계속 따라가는 동기화 코드로 읽기 시작하면 바로 꼬인다.
