+++
author = "오깅중"
title = "Swift mutating인데 self를 안 바꾸는 함수 — 컴파일 통과하는 시그니처의 함정"
slug = "swift-mutating-without-self-mutation"
date = "2026-05-13T14:20:00+09:00"
description = "mutating 키워드는 self 변경 의도를 표현하는 계약이다. 컴파일러는 그 의미를 검증하지 않아서, self를 안 바꾸는 함수에도 mutating이 붙어 통과한다. PR 리뷰에서 만난 실제 사례와 builder 패턴 대안."
categories = ["Swift"]
tags = ["Swift", "mutating", "Struct", "BuilderPattern", "CodeReview"]
+++

PR 리뷰에서 이런 코드를 봤다.

```swift
public struct NotificationSettingSnippet {
    public let isEnabledAll: Bool
    public let isEnabledFeatureA: Bool
    // ... 20개 더 ...

    public mutating func updateValue(
        isEnabledAll: Bool? = nil,
        isEnabledFeatureA: Bool? = nil,
        // ... 동일하게 22개 ...
    ) -> Self {
        return .init(
            isEnabledAll: isEnabledAll ?? self.isEnabledAll,
            isEnabledFeatureA: isEnabledFeatureA ?? self.isEnabledFeatureA,
            // ...
        )
    }
}
```

호출부.

```swift
guard var settingSnippet = subject.value else { return }
useCases.updateSettings(
    snippet: settingSnippet.updateValue(isEnabledFeatureA: true),
    ...
)
```

`settingSnippet`이 재할당되지도 않는데 `var`다. `let`으로 바꾸자고 제안하니 "`mutating func`라 `var`가 필요합니다. let으로 변경 시 컴파일 에러 발생합니다"라는 답이 왔다. 컴파일러는 정말 그렇게 시킨다. 그런데 **mutating일 이유가 있는가?**

## 세 가지 모순

**1. self를 mutate하지 않는다.** 함수 본문은 새 `Self` 인스턴스를 만들어 return할 뿐이다. self의 상태는 손대지 않는다.

**2. 모든 프로퍼티가 let.** `self.isEnabledAll = ...` 같은 in-place 변경이 애초에 불가능하다. mutating으로 self를 변경하려면 `self = .init(...)` 패턴밖에 안 된다. 그런데 이 함수는 그것도 안 함.

**3. 시그니처 자체가 모순.** `mutating`은 "self를 변경한다"는 계약이고 `-> Self`는 "새 값을 반환한다"는 계약이다. 호출자가 두 의도를 동시에 받게 된다.

```swift
var snippet = ...
snippet.updateValue(isEnabledFeatureA: true)              // ① 결과 무시, mutating 의존
let new = snippet.updateValue(isEnabledFeatureA: true)    // ② 반환값만 사용
snippet = snippet.updateValue(isEnabledFeatureA: true)    // ③ 재할당
```

세 가지 호출 패턴 중 어느 것이 의도된 사용인가? 시그니처만으론 알 수 없다. 실제 동작은 self를 안 바꾸므로 ①은 무용지물이다. 그런데 mutating이 붙어 있어 호출부는 `var`를 강제받는다. **의미는 ②인데 시그니처는 ①인 척하는 셈**이다.

## 컴파일러는 무엇을 검증하지 않나

핵심은 여기다. `mutating` 키워드는 컴파일러에게 "이 함수는 self를 변경할 수 있다"는 권한을 요구하는 표시일 뿐, 함수 본문에서 정말로 self를 바꾸는지는 **검증되지 않는다**.

```swift
mutating func doNothing() {
    // self를 손대지 않아도 통과
}

mutating func builder() -> Self {
    return .init(...)  // 새 인스턴스 반환만 해도 통과
}
```

두 함수 모두 `mutating`이지만 self의 상태가 변하지 않는다. 컴파일러는 "변경할 수 있다"는 권한만 보지 "변경했다"는 사실은 확인하지 않는다. 그래서 의도와 시그니처가 어긋난 코드가 그대로 빌드된다.

## 성능 측면

"mutating이 성능에 안 좋지 않나?" — 큰 차이는 없다. mutating은 컴파일러가 self를 `inout`으로 받게 하는 힌트 정도다. 다만 이 케이스처럼 22개 프로퍼티 struct에서 **mutating + 새 인스턴스 반환을 함께 하면 self 복사 + 재할당 비용이 호출마다 발생**한다. 비용보다 의미적 모순이 더 큰 문제지만 비용도 작지 않다.

## 해결

mutating 떼고 builder 스타일로.

```swift
public func updatingValue(
    isEnabledAll: Bool? = nil,
    // ...
) -> Self {
    return .init(...)
}
```

함수명도 builder 의도가 드러나게 `updatingValue`로 바꿨다. 이제 호출부는 자연스럽게 `let`.

```swift
guard let settingSnippet = subject.value else { return }
useCases.updateSettings(
    snippet: settingSnippet.updatingValue(isEnabledFeatureA: true),
    ...
)
```

`var`/`let`의 표면이 정리되니 호출자가 의도를 한눈에 안다. "기존 값에 변경 사항을 얹은 새 값을 만든다" — 정확히 builder 패턴이 표현하려는 것.

## 네이밍 컨벤션

Swift 표준 라이브러리도 같은 구분을 일관되게 한다.

| in-place 변경 | 새 인스턴스 반환 |
|---------------|------------------|
| `sort()` | `sorted()` |
| `reverse()` | `reversed()` |
| `append(_:)` | `appending(_:)` |

`-ed` / `-ing` 분사형 또는 `with(...)` 접두사는 "결과를 반환한다"는 신호다. 도메인 struct에서도 같은 컨벤션을 따르면 호출 측이 시그니처만 보고도 의도를 잡을 수 있다.

## 교훈

컴파일러는 "self를 변경한다"는 의미를 검증하지 않는다. mutating을 붙여도 본문에서 안 바꾸면 통과한다. 그래서 **mutating은 함수가 self를 진짜 in-place 변경할 때만 붙여야 의미가 산다**.

builder 패턴이 필요할 땐 mutating을 쓰지 않는다. 함수명을 `-ing`(`updatingValue`)이나 `with(...)` 같은 형용사 위치 단어로 두면 호출부가 자연스럽고 의도도 안 헷갈린다.

리뷰에서 `var`/`let`을 묻는 이슈가 올라오면, **그 표면 밑에 시그니처와 의도의 불일치가 있지 않은지** 한 번 들여다보자. 대부분의 경우 진짜 문제는 표면이 아니라 그 아래에 있다.
