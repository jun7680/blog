+++
author = "오깅중"
title = "Swift 6에서 매일 만나는 변화 7가지 — strict concurrency부터 typed throws까지"
slug = "swift-6-language-changes"
date = "2026-05-13T13:30:00+09:00"
description = "Swift 6에서 매일 실무 코드를 만질 때 부딪히는 변경 7가지 정리. strict concurrency 모드, Sendable 강제, typed throws, existential any 강화, migration mode 등."
categories = ["Swift"]
tags = ["Swift", "Swift 6", "Concurrency", "Sendable", "TypedThrows"]
image = "thumbnail.png"
+++

Swift 6가 풀린 지 한참 됐는데 5.10에서 곧장 6으로 점프하면 컴파일 에러가 줄줄이 뜨는 게 정상이다. 가장 큰 이유는 **strict concurrency 검사가 기본 켜진** 것. 그 외에도 매일 만지는 코드에 영향이 큰 변화들이 꽤 있다. 한 번 정리해 둔다.

## 1. Strict Concurrency 강제 — 가장 큰 변화

Swift 5.x에서 `-strict-concurrency=complete`로 켜야 봤던 검사가 Swift 6에선 **기본**이다. 즉 data race가 가능한 코드는 컴파일 에러.

```swift
// Swift 5: 경고 정도였던 코드
class Counter {
    var value = 0
}

func bump(counter: Counter) {
    Task { counter.value += 1 }   // Swift 6에서 에러: Counter is not Sendable
}
```

해결의 정공법은 actor로 격리하거나, 변경 없는 값 타입으로 바꾸거나, `@MainActor` 같은 격리 어노테이션을 명시하는 것.

```swift
@MainActor
final class Counter {
    var value = 0
}
```

옛 코드를 한 번에 다 고치는 게 부담스러우면 다음 항목(migration mode)을 활용.

## 2. Migration Mode — 점진 마이그레이션의 친구

`-language-mode 5`로 일부 파일/모듈만 Swift 5로 유지하면서, 점진적으로 Swift 6로 옮길 수 있다. Package.swift 또는 Xcode 빌드 설정에서 모듈 단위로 지정 가능.

```swift
// Package.swift
.target(
    name: "LegacyModule",
    swiftSettings: [.swiftLanguageMode(.v5)]
)
```

새로 짜는 모듈만 Swift 6로 가고, 옛 모듈은 5 유지 → 빌드는 통과. 한 모듈씩 차근차근 옮기는 게 회귀 위험 가장 적음.

## 3. Sendable 검사 강화

Sendable은 "스레드 경계를 넘나들어도 안전한 타입"의 마커 프로토콜. Swift 6는 actor 경계나 `Task.detached`를 넘는 값에 대해 컴파일 타임에 Sendable인지 검사한다.

```swift
struct Config {
    var name: String
    var count: Int
}

func process(_ config: Config) async {
    await Task.detached {
        print(config.name)   // Swift 6: Config must conform to Sendable
    }.value
}
```

해결: `struct Config: Sendable { ... }`. 모든 stored property가 Sendable이면 자동 합성됨. 클래스라면 `final class + 모든 프로퍼티 let` 또는 actor로 격리.

## 4. Typed Throws — 에러 타입 명시

`throws` 뒤에 구체 에러 타입을 적을 수 있다.

```swift
func fetchUser(id: Int) throws(APIError) -> User {
    // throw APIError.notFound 만 가능
    // 다른 에러는 컴파일 에러
}

do {
    let user = try fetchUser(id: 42)
} catch {
    // error의 타입이 APIError로 추론됨 (any Error 아님)
    switch error {
    case .notFound: ...
    case .timeout: ...
    }
}
```

옛 `throws`는 `throws(any Error)`와 동일. 새 API 설계할 땐 가능한 구체 에러 타입을 명시해서 호출자가 정확히 분기할 수 있게 하는 게 권장.

## 5. Existential any 강제

5.7에서 권장이었던 `any` 키워드가 6에선 **필수**다. 옛 코드의 `protocol Transport`를 그냥 타입 자리에 쓰면 에러.

```swift
// Swift 5: 경고
var transport: Transport = CarTransport()

// Swift 6: 컴파일 에러
// 수정
var transport: any Transport = CarTransport()
```

성능 의도를 명시할 수 있는 자리에선 `some`이 우선. existential boxing 비용이 안 드는 쪽.

## 6. count(where:) 등 표준 라이브러리 추가

매일 만지는 collection 함수에 작은 편의 추가가 꽤 있다.

```swift
let numbers = [1, 2, 3, 4, 5]
let evenCount = numbers.count(where: { $0.isMultiple(of: 2) })  // 2
```

`filter { ... }.count`보다 중간 배열을 만들지 않아 더 효율적. 비슷하게 `Dictionary.subscript(_:default:)`로 기본값 처리, `String.trimmingPrefix(_:)` / `trimmingSuffix(_:)` 등.

## 7. Noncopyable 타입 — `~Copyable`

복사할 수 없는 타입을 정의할 수 있다. 파일 핸들, 락처럼 "복사하면 안 되는" 리소스를 컴파일 타임에 강제.

```swift
struct FileHandle: ~Copyable {
    private let fd: Int32

    init(path: String) throws {
        self.fd = open(path, O_RDONLY)
    }

    deinit { close(fd) }
}

let h1 = try FileHandle(path: "log.txt")
let h2 = h1   // Swift 6: 컴파일 에러 - cannot copy noncopyable
```

소유권 모델이 들어온 첫걸음이라 모든 케이스에 쓸 일은 없지만, 리소스 관리 코드를 더 안전하게 짤 수 있다.

## 옮기면서 가장 자주 만나는 패턴

옛 프로젝트에 Swift 6를 켜면 거의 모든 에러가 다음 둘 중 하나로 수렴한다.

1. **"X is not Sendable"** — actor 경계를 넘는 값이 Sendable이 아님. 값 타입이면 `: Sendable` 추가, 클래스면 actor 격리나 `final class + Sendable` 검토.
2. **"Reference to protocol 'X' requires 'any'"** — 프로토콜 타입을 변수/파라미터로 받는 자리. `any X` 또는 `some X`로 명시.

이 둘만 정리하면 80%는 끝난다. 나머지는 typed throws나 `~Copyable` 도입 같은 *추가 기능* 영역이라 점진적으로 들이면 됨.

## 정리

- Swift 6의 핵심은 **strict concurrency를 컴파일 타임 보장으로 끌어올린 것**. 옛 경고가 다 에러가 됐다.
- 한 번에 다 못 옮기면 `swiftLanguageMode(.v5)`로 모듈 단위 점진 마이그.
- typed throws / `~Copyable` / `count(where:)` 같은 작은 개선이 매일 쓰는 코드에 의외로 자주 들어옴.
- 5.7에서 권장이었던 `any`가 6에선 필수. 옛 코드의 `Transport`를 `any Transport`로 다 손봐야.

다음 단계로 strict concurrency를 본격적으로 다루는 글을 따로 정리할 예정. `@preconcurrency`, actor 격리 전략, `nonisolated(unsafe)` 우회 같은 실무 패턴은 분량이 커서 한 글에 다 들어가지 않는다.

Swift 6 마이그레이션은 한 번에 끝낼 일이 아니라 **모듈 단위로 천천히 옮기는 작업**이라고 생각하면 부담이 훨씬 덜하다.
