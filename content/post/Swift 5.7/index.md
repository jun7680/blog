+++
author = "오깅중"
title = "Swift 5.7에서 매일 쓰는 개선 7가지"
date = "2022-06-15"
description = "Swift 5.7에 들어온 변경 중 실무에서 매일 쓰게 되는 것들 위주 정리. if let 단축, any/some, 정규식 리터럴, distributed actor, 클로저 추론, 새 String 처리, Generics where 구문까지."
categories = ["Swift"]
tags = ["Swift", "Swift 5.7"]
+++

WWDC 2022에서 Swift 5.7이 같이 풀렸다. 보통은 이런 마이너 버전에 큰 변화가 없는데, 5.7은 일상 코드에 영향을 주는 변경이 꽤 많아서 한 번 정리해 둔다. 다 적으면 너무 길어지니까 매일 쓰게 되는 7가지만 추렸다.

## 1. if let / guard let 단축 표기

가장 환영받는 변경. 옵셔널 언래핑할 때 같은 이름을 두 번 쓰던 패턴이 사라졌다.

```swift
// 이전
if let user = user {
    show(user)
}

// 5.7
if let user {
    show(user)
}
```

`guard let`, `while let`도 동일하게 적용. 변수 이름이 길어질수록 효과가 크다.

```swift
var wwdcPresentationContent: String?

// 이전
if let content = wwdcPresentationContent {
    print(content)
}

// 5.7
if let wwdcPresentationContent {
    print(wwdcPresentationContent)
}
```

이름을 그대로 살리고 싶을 때 가장 깔끔.

## 2. any와 some — Existential vs Opaque의 명시화

5.7부터 프로토콜을 타입처럼 쓸 때 `any` 키워드 명시가 권장된다.

```swift
// 이전
var transport: Transport

// 5.7
var transport: any Transport
```

`any Transport`는 **existential**(어떤 타입이든 들어갈 수 있는 박스). 반면 `some Transport`는 **opaque**(컴파일 타임에 단일 타입으로 확정되지만 호출자에겐 감춤).

```swift
func makeRoute() -> some Route { CarRoute() }   // 호출자엔 some Route, 실제는 CarRoute
func anyRoute() -> any Route { CarRoute() }     // 어떤 Route든 들어가는 박스
```

성능 측면에서 `some`이 보통 더 효율적이다. existential은 dynamic dispatch + boxing 오버헤드가 있음. 5.7 이후로는 둘을 의도적으로 구분해서 쓰는 게 표준이 됐다.

## 3. Regex Literal — 정규식이 1급 시민

기존엔 `NSRegularExpression`으로 문자열에서 패턴 매칭을 했는데, 5.7부터 정규식 리터럴과 빌더 DSL이 들어왔다.

```swift
let log = "2026-05-13 10:30:00 ERROR Something failed"

if let match = log.firstMatch(of: /(\d{4})-(\d{2})-(\d{2})/) {
    print("year:", match.1)
    print("month:", match.2)
    print("day:", match.3)
}
```

캡처 그룹이 `match.1`, `match.2`처럼 **타입 안전한 튜플 인덱스**로 노출된다. 빌더 DSL을 쓰면 정규식 패턴 자체도 Swift 코드로 표현 가능.

```swift
import RegexBuilder

let datePattern = Regex {
    Capture { Repeat(.digit, count: 4) }
    "-"
    Capture { Repeat(.digit, count: 2) }
    "-"
    Capture { Repeat(.digit, count: 2) }
}
```

문법이 어렵지 않은 정규식이라면 리터럴, 복잡한 패턴이면 빌더 — 라는 식으로 갈리는 듯하다.

## 4. Generics의 some / any가 파라미터에서도 자연스러워짐

이전엔 함수 시그니처에 제네릭을 쓸 때 `<T: Animal>` 식의 거추장스러운 표기였는데, 5.7은 `some`을 파라미터 위치에서도 그대로 쓸 수 있다.

```swift
// 이전
func feed<A: Animal>(_ animal: A) { ... }

// 5.7
func feed(_ animal: some Animal) { ... }
```

표기가 짧아지고 의도가 분명해진다. 단순 파라미터 한 개짜리 제네릭은 거의 다 `some`으로 바꿀 수 있다.

## 5. Distributed Actor

`actor`를 분산 시스템 경계 너머로 확장한 개념. 다른 프로세스/머신에 있는 actor에도 같은 호출 문법으로 메시지를 보낼 수 있다.

```swift
import Distributed

distributed actor ChatRoom {
    distributed func send(_ message: String) async throws { ... }
}
```

서버사이드 Swift나 Apple Watch ↔ iPhone 같은 멀티 디바이스 시나리오에서 의미가 크다. iOS 일반 앱에서 당장 쓸 일은 많지 않지만, "있다"는 것 정도는 알아두면 좋음.

## 6. Multi-statement closure 타입 추론 강화

이전엔 클로저 본문이 두 줄 이상이면 반환 타입을 명시해야 하는 경우가 잦았다. 5.7은 본문이 복잡해도 추론이 잘 되도록 컴파일러가 개선됐다.

```swift
let labels = numbers.map { number in
    let formatted = String(format: "%03d", number)
    return "Number is \(formatted)"
}
```

옛 컴파일러는 위 코드에서 `-> String`을 명시해야 추론이 됐는데, 5.7은 알아서 잡는다. Combine 체이닝처럼 클로저가 깊게 들어가는 코드에서 체감이 큼.

## 7. Generics where 구문 — 어디서나 사용 가능

`where`로 제약을 거는 위치 제한이 풀렸다.

```swift
extension Array {
    func averageDistance() -> Double where Element == Double { ... }
}
```

이전엔 protocol·extension 선언부에서만 가능했던 `where`가 메서드/프로퍼티 레벨에서도 자유롭게. 라이브러리 만들 때 활용도가 높다.

## 정리

- `if let`/`guard let` 단축, `some` 파라미터, 클로저 추론은 **일상 코드 줄 수 자체를 줄여줌**.
- `any`/`some` 명시는 **성능 의도를 코드에 박는 효과** — 한 번 익혀두면 옛 코드에서 거슬리는 게 보이기 시작.
- Regex 리터럴은 **NSRegularExpression 제거의 시작**. 새 코드는 다 새 API로 가도 무방.

세부 변경 전체 목록은 [What's new in Swift 5.7 (Hacking with Swift)](https://www.hackingwithswift.com/articles/249/whats-new-in-swift-5-7)에 잘 정리돼 있다.

5.7 이후로도 5.9의 매크로, 6.0의 strict concurrency 같은 굵직한 변경이 이어졌지만, 5.7에서 잡힌 표기·추론 개선이 그 이후의 변경을 자연스럽게 받아들이게 만든다는 점에서 중요한 마디 같음.
