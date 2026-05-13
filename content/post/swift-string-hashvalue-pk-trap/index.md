+++
author = "오깅중"
title = "Swift String.hashValue로 DB PK를 만들면 안 되는 이유"
slug = "swift-string-hashvalue-pk-trap"
date = "2026-05-13T15:35:00+09:00"
description = "Swift의 String.hashValue는 per-process random seed라서 앱 재시작마다 값이 바뀐다. DB PK로 박으면 lookup이 영구 실패한다. 결정적 hash로 가야 하는 이유와 마이그레이션 처리."
categories = ["Swift"]
tags = ["SwiftData", "Hashable", "PrimaryKey", "Migration", "Debugging"]
image = "thumbnail.png"
+++

SwiftData 마이그 중에 상세 화면이 자꾸 "데이터 로드 실패"로 떨어지는 버그를 잡고 있었다. 리스트엔 아이템이 멀쩡히 보이는데 탭만 하면 바로 `dataNotFound`. 더 빡친 건 앱 재시작할수록 실패하는 아이템이 점점 늘어남.

DAO 코드 한참 보다가 PK 만드는 부분에서 손이 멈췄다.

```swift
extension ItemEntity2 {
    static func makeID(containerID: Int, remoteItemID: Int) -> Int {
        return "\(containerID)-\(remoteItemID)".hashValue
    }
}
```

문자열 합쳐서 `.hashValue` 박는 패턴. 자주 보이는 idiom이라 의심 없이 통과할 만한 코드. 근데 이게 원인이었다.

## Swift String.hashValue의 비밀

Swift의 `String.hashValue`는 **프로세스마다 다르다**. 같은 문자열을 같은 OS, 같은 빌드에서 호출해도 앱 재실행되면 값이 바뀜.

```swift
// 세션 A에서
"1-123".hashValue  // 예: 7842934729384

// 앱 재시작 후 세션 B에서
"1-123".hashValue  // 예: -1283742983742
```

왜? Swift의 `Hashable` 구현은 **per-process random seed**를 씀. 보안적 동기 — hash flooding 공격(악의적 입력으로 dict의 hash collision을 유도해 O(n²)로 만드는 공격) 방지하려고 프로세스 시작 시 seed를 무작위로 결정함. ASLR이랑 같은 결의 방어 메커니즘.

dict의 in-memory bucket lookup에는 아무 문제 없음. 같은 프로세스 안에선 seed가 일정하니까. 근데 **DB에 영구 저장하면 얘기가 다름**.

## 무엇이 일어났는가

```
세션 A:
  insert(id: hash("1-123") = 7842934729384, ...)
  → DB에 저장됨

(앱 재시작)

세션 B:
  let id = hash("1-123") = -1283742983742  // 값이 다름!
  context.fetch(predicate: #Predicate { $0.id == id })
  → 0건 반환 (실제 데이터는 7842934729384로 저장돼 있음)
```

upsert는 update 대신 insert로 빠지고, lookup은 영구 실패. 매 재시작마다 중복 행이 누적되고, 화면에선 "데이터 없음"으로 보임. `try? context.save()`는 unique 제약 위반에도 에러를 삼키니 로그도 안 남음.

증상은 "조용히 모든 게 안 됨". 디버깅 진짜 미쳐버린다.

## 해결: 결정적 산술 hash

PK는 **프로세스 무관하게 같은 입력에 항상 같은 출력**이어야 한다. 그래서 직접 산술 hash로 짜야 함. Boost의 `hash_combine` 패턴이 좋은 출발점.

```swift
extension ItemEntity2 {
    static func makeID(containerID: Int, remoteItemID: Int) -> Int {
        var seed: Int = 0
        seed = hashCombine(seed, containerID)
        seed = hashCombine(seed, remoteItemID)
        return seed
    }

    // Boost의 hash_combine: golden ratio 상수 사용
    private static func hashCombine(_ seed: Int, _ value: Int) -> Int {
        let goldenRatio = Int(bitPattern: 0x9E3779B97F4A7C15)
        return seed ^ (value &+ goldenRatio &+ (seed &<< 6) &+ (seed &>> 2))
    }
}
```

`0x9E3779B97F4A7C15`는 황금비 기반 상수로, 비트 분포를 고르게 흩뿌리는 효과가 있어서 collision이 적다.

scope 같은 2-state enum이 끼면 더 간단하게 비트 패킹도 가능.

```swift
static func makeID(remoteItemID: Int, scope: ItemScopeType) -> Int {
    return (remoteItemID &<< 1) | scope.rawValue
}
```

핵심은 **프로세스 무관 + 결정적** 두 조건.

## 마이그레이션 처리

이미 `.hashValue`로 저장된 데이터가 운영 중인 DB에 있다면? 알고리즘 바꾸는 순간 기존 row의 id가 새 알고리즘으로 다시 계산되지 않으므로 **lookup 자체가 안 됨**. 일회성 wipe 마이그레이션 필요.

```swift
enum SwiftDataBootstrap {
    static func applyDeterministicPKMigrationIfNeeded() {
        let key = "swiftdata.pkMigration.deterministicV1.applied"
        guard !UserDefaults.standard.bool(forKey: key) else { return }

        // 영향받는 Entity 전부 wipe
        let context = ModelContext(container)
        try? context.delete(model: ItemEntity2.self)
        try? context.delete(model: ItemAlphaEntity2.self)
        try? context.delete(model: ItemBetaEntity2.self)
        try? context.save()

        UserDefaults.standard.set(true, forKey: key)
    }
}
```

UserDefaults flag로 1회만 실행 보장. 다음 sync 사이클에서 서버가 다시 채워줌.

## 교훈

`.hashValue`는 **메모리 내 lookup 전용**. 디스크에 박는 순간 함정이 됨.

DB PK 만들 때 점검 리스트:

- [ ] 같은 입력에 항상 같은 출력? (결정적)
- [ ] 프로세스 재시작에도 같은 출력? (per-process seed 사용 안 함)
- [ ] OS/플랫폼/Swift 버전 바뀌어도 같은 출력? (산술만 사용)

`String.hashValue`, `Hasher.combine`, `AnyHashable` 다 1번은 충족하지만 2번을 깬다. 산술 hash(`hash_combine` 류) 또는 비트 패킹으로 가야 함.

## 참고

- [SE-0206 Hashable Enhancements](https://github.com/apple/swift-evolution/blob/main/proposals/0206-hashable-enhancements.md) — Swift Hashable이 per-process seed를 도입한 경위
- [Boost hash_combine](https://www.boost.org/doc/libs/release/doc/html/hash/reference.html#boost.hash_combine)
