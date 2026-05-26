+++
author = "오깅중"
title = "@Bindable vs @Binding, 둘이 뭐가 다른지 한 번 정리"
slug = "swiftui-bindable-vs-binding"
date = "2026-05-26T14:15:00+09:00"
description = "iOS 17에서 @Bindable이 추가되면서 @Binding이랑 헷갈리기 시작했다. 언제 뭘 써야 하는지 한 번에 정리."
categories = ["SwiftUI"]
tags = ["SwiftUI", "Bindable", "Binding", "Observable", "iOS17"]
image = ""
+++

iOS 17에서 `@Observable` 매크로가 들어오면서 `@Bindable`이라는 새 property wrapper가 같이 붙어 왔다. 이름이 `@Binding`이랑 한 글자 차이라 처음엔 "이게 뭐 다른 건가" 싶었는데, 막상 자식 view에 모델 넘기다가 `$model.name`이 컴파일이 안 돼서 한참 헤맸다. 두 번 헷갈리기 싫어서 정리해둔다.

환경은 Xcode 26.4 / iOS 17+ 기준이다. `@Bindable` 자체가 iOS 17부터라 그 아래는 해당 없다.

## 한 줄 요약부터

- `@Binding`: 부모가 들고 있는 source-of-truth를 자식이 양방향으로 잡고 싶을 때. 이건 예전부터 그대로다.
- `@Bindable`: 이미 만들어져 있는 `@Observable` 클래스에서 binding을 꺼내 쓰고 싶을 때.

비슷해 보이지만 역할이 다르다. `@Binding`은 binding을 **받는** 쪽이고, `@Bindable`은 observable 객체에서 binding을 **만들어주는** 도구다.

## @Binding은 그대로다

`@Binding`은 iOS 13부터 있던 그거 그대로다. 부모가 `@State`로 들고 있는 값을 자식이 같이 읽고 쓰고 싶을 때 쓴다.

```swift
struct ParentView: View {
    @State private var name = ""

    var body: some View {
        ChildView(name: $name)
    }
}

struct ChildView: View {
    @Binding var name: String

    var body: some View {
        TextField("이름", text: $name)
    }
}
```

이건 value type이든 reference type이든 상관없이 같은 패턴이다. 부모가 source-of-truth를 갖고, 자식은 그걸 binding으로 빌려 쓴다.

## @Bindable이 왜 필요한가

`@Observable` 클래스를 자식 view에 넘긴다고 해보자. 읽기만 할 거면 그냥 받으면 된다.

```swift
@Observable
final class UserModel {
    var name: String = ""
    var age: Int = 0
}

struct ProfileView: View {
    let user: UserModel  // 그냥 받아도 추적은 잘 된다

    var body: some View {
        Text(user.name)  // user.name이 바뀌면 이 view는 재평가됨
    }
}
```

여기까진 문제없다. `@Observable` 매크로 덕분에 `user.name`을 읽는 것만으로 의존성이 자동 등록된다. 그런데 `TextField`처럼 binding이 필요한 자리에 `$user.name`을 쓰려고 하면 컴파일러가 막아선다.

```swift
struct ProfileEditView: View {
    let user: UserModel

    var body: some View {
        TextField("이름", text: $user.name)  // 컴파일 에러
    }
}
```

여기에 `@Bindable`을 붙여주면 풀린다.

```swift
struct ProfileEditView: View {
    @Bindable var user: UserModel

    var body: some View {
        TextField("이름", text: $user.name)  // 이제 됨
        Stepper("나이: \(user.age)", value: $user.age)
    }
}
```

`@Bindable`은 "이 observable 객체의 property를 binding으로 꺼낼 수 있게 해줘"라는 선언이다. 객체의 소유권이 바뀌는 게 아니다. 부모가 만든 그 인스턴스를 그대로 참조하면서, binding 추출만 가능해진다.

## 인라인으로도 쓸 수 있다

매번 자식 view를 만들기 싫고 그 자리에서 잠깐만 binding이 필요하면, body 안에서 `@Bindable`을 지역으로 선언할 수도 있다.

```swift
struct ProfileEditView: View {
    let user: UserModel

    var body: some View {
        @Bindable var user = user
        return VStack {
            TextField("이름", text: $user.name)
        }
    }
}
```

이름 가리기(shadowing)가 좀 어색하지만 공식적으로 지원되는 패턴이다. 컴포넌트로 빼기 애매한 한두 줄짜리 상황에서 쓸 만하다.

## 결정 가이드

머릿속에서 이 순서로 묻고 답하면 거의 안 헷갈린다.

1. 자식이 넘겨받는 게 **value 타입**(`String`, `Int`, struct 등)인가? → `@Binding`
2. 넘겨받는 게 `@Observable` 클래스인가?
   - 읽기만 한다 → 그냥 받기 (`let user: UserModel`)
   - `$user.name` 형태로 binding이 필요하다 → `@Bindable`
3. 부모가 `@State`로 들고 있던 reference를 자식이 잡고, 그게 `@Observable`이 아니다? → 이 경우는 거의 없지만, 굳이라면 `@Binding`

대부분의 경우 2번에서 답이 나온다. `@Observable`을 쓰면서부터는 `@ObservedObject`, `@StateObject`, `@EnvironmentObject`가 각각 그냥 변수, `@State`, `@Environment`로 대체됐고, `@Bindable`은 그 패밀리의 마지막 한 조각이라고 생각하면 정리가 쉽다.

| 예전 (ObservableObject) | 지금 (@Observable) |
|---|---|
| `@StateObject var vm = VM()` | `@State private var vm = VM()` |
| `@ObservedObject var vm: VM` | `let vm: VM` (또는 binding 필요 시 `@Bindable var vm: VM`) |
| `@EnvironmentObject var vm: VM` | `@Environment(VM.self) var vm` (binding 필요 시 `@Bindable`로 한 번 더 감싸기) |
| `$vm.name` (자동) | `@Bindable` 붙인 다음에 `$vm.name` |

옛 코드에서 `@ObservedObject`만 지우고 `@Observable`로 바꿨더니 binding이 안 꺼내져서 당황한 적이 있다면 이 표 한 줄이 답이다.

## 정리

`@Binding`은 그대로다. `@Bindable`은 `@Observable` 클래스에서 binding을 꺼내려고 추가됐다. 둘은 경쟁 관계가 아니라 역할이 다른 도구다. 자식 view에 모델 넘길 때 컴파일러가 `$model.prop`에서 빨간 줄을 그으면, 그건 거의 항상 `@Bindable` 한 줄 빠진 거다.
