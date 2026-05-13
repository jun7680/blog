+++
author = "오깅중"
title = "SwiftData #Predicate에서 enum 비교가 0건을 반환하는 이유"
slug = "swiftdata-predicate-enum-silent-zero"
date = "2026-05-13T15:42:00+09:00"
description = "SwiftData #Predicate가 사용자 정의 enum을 만나면 throw 없이 0건을 반환한다. SQL 번역 실패가 침묵으로 드러나는 함정. raw value 컬럼, Swift filter, PK 인코딩 세 가지 우회법."
categories = ["Swift"]
tags = ["SwiftData", "Predicate", "Enum", "Debugging"]
image = "thumbnail.png"
+++

SwiftData 마이그레이션 작업 중에 가장 디버깅이 어려웠던 건 "에러는 안 나는데 결과가 빈" 케이스였다.

```swift
let scope: ItemScopeType = .inbox

let descriptor = FetchDescriptor<ItemEntity2>(
    predicate: #Predicate { $0.scope == scope }
)
let results = try context.fetch(descriptor)
// results.count == 0
```

DB에는 분명히 `scope = .inbox`인 row가 100건 들어있다. 그런데 predicate는 0건을 반환한다. throw도 없고, 로그도 없다.

## 원인: SQL 번역 실패

`ItemScopeType`은 이렇게 생긴 enum이었다.

```swift
enum ItemScopeType: Int, Codable {
    case inbox = 0
    case outbox = 1
    case draft = 2
}
```

SwiftData `@Model`은 이걸 `Codable raw value`로 저장한다. `scope = .inbox`는 DB에 정수 `0`으로 들어간다. 거기까진 정상이다.

문제는 **`#Predicate`가 SQL로 컴파일되는 단계**다. SwiftData는 `#Predicate` 클로저를 분석해서 SQLite의 `WHERE` 절로 번역한다. 그런데 사용자 정의 enum 타입은 SQL 단에서 이해할 수 없다. SwiftData가 번역을 포기하면 — **throw 대신 빈 결과를 반환한다**.

```swift
#Predicate { $0.scope == scope }
// → SQL: WHERE scope = ??? (번역 실패)
// → 실행 자체는 되지만 매칭 0건
```

표준 타입(`Int`, `String`, `Bool`, `Date` 등)이면 SQL로 직역되니까 잘 동작한다. enum, `OptionSet`, 커스텀 struct 등은 침묵 속에 0건을 받는다.

## 어디까지가 되고 어디서부터 안 되는가

같은 enum이라도 사용 위치에 따라 다르다.

```swift
// ❌ FetchDescriptor의 predicate — SQL 번역 단계
let descriptor = FetchDescriptor<E>(predicate: #Predicate { $0.scope == .inbox })
try context.fetch(descriptor)  // 0건

// ✅ Swift array filter — 메모리에서 Swift 코드 실행
let all = try context.fetch(FetchDescriptor<E>())
let filtered = all.filter { $0.scope == .inbox }  // 정상
```

`#Predicate` 자체는 컴파일 통과한다. 런타임에 SQL로 번역할 때만 실패한다. 그러니 컴파일러도, 빌드 시스템도 아무 경고를 못 준다.

`OptionSet`도 같은 함정에 빠진다.

```swift
// ItemFlagsType = OptionSet (상태 플래그)
#Predicate { $0.flags.contains(.read) }  // SQL bitwise 번역 못 함 → 0건
```

## 해결 패턴

세 가지 길이 있다.

### 1. 결정적 Int 컬럼으로 빼기

자주 조회하는 enum은 raw value를 별도 Int 컬럼으로 두고, 그걸 predicate에 쓴다.

```swift
@Model
final class ItemEntity2 {
    var scope: ItemScopeType  // 도메인용
    var scopeRaw: Int         // 쿼리용

    init(scope: ItemScopeType, ...) {
        self.scope = scope
        self.scopeRaw = scope.rawValue
    }
}

#Predicate { $0.scopeRaw == 0 }  // ✅ 동작
```

중복 컬럼이 거슬리지만, hot path predicate에서는 이 방법이 가장 빠르고 안전하다.

### 2. fetch 전체 후 Swift filter

데이터셋이 작거나 메모리 부담이 없으면 그냥 다 가져와서 Swift에서 filter한다.

```swift
let all = try context.fetch(FetchDescriptor<E>(
    predicate: #Predicate { $0.remoteItemID == itemID }  // 표준 타입만
))
return all.filter { $0.scope == .inbox }
```

문제는 데이터셋이 큰 케이스에서 메모리 폭발과 throughput 저하가 일어난다.

### 3. PK에 enum 정보 인코딩

scope가 2-3개 값으로 제한적이면 PK 자체에 비트로 끼워 넣는 게 가능하다.

```swift
static func makeID(itemID: Int, scope: ItemScopeType) -> Int {
    return (itemID &<< 2) | scope.rawValue
}
```

같은 itemID라도 scope별로 PK가 다르니 unique 제약을 거치고, predicate는 itemID/scope 조합으로 정확하게 lookup된다. 다만 PK 알고리즘이 도메인을 가지게 되어 결합도가 높아진다.

## 왜 SwiftData가 throw하지 않는가

확실하지 않지만 가능한 이유:

- 일부 predicate가 SQL로 번역 안 되어도 in-memory evaluation으로 fallback 가능. SwiftData가 이걸 시도 → 결과 없음 → 빈 array 반환.
- Predicate API가 너무 광범위해서 "지원 안 됨"을 컴파일 타임에 잡기 어려움. 런타임에 silent fallback이 차선책.

이유야 어떻든 디버깅 입장에선 최악이다. **에러가 나야 할 자리에 빈 결과를 받으면 데이터 자체가 없는 줄 안다**.

## 교훈

`#Predicate`에는 **표준 타입만** 넣는다. 커스텀 enum, OptionSet, 커스텀 struct는 못 넣는다고 가정하라.

- enum을 조건에 자주 쓴다면 raw value를 별도 컬럼으로 (or PK에 인코딩)
- 한두 번만 쓰는 거면 fetch 후 Swift filter
- "왜 결과가 없지?"를 의심하기 시작했다면 predicate에 표준 외 타입이 끼었는지 먼저 확인

SwiftData는 Swift로 쓰지만 SQL로 실행된다. 두 세상의 경계는 `#Predicate`다. 그 경계에서 무엇이 번역되는지 알아두면 침묵을 미리 피할 수 있다.
