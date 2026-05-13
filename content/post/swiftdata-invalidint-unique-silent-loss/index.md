+++
author = "오깅중"
title = "@Model 스캐폴드 id + .unique 제약 = 조용한 데이터 손실"
slug = "swiftdata-invalidint-unique-silent-loss"
date = "2026-05-13T15:40:00+09:00"
description = "SwiftData에서 sentinel default id(.invalidInt = -1)와 @Attribute(.unique)와 try?가 만나면 100건이 1건으로 줄어든다. 에러 없이. 다층 방어로 막는 법."
categories = ["Swift"]
tags = ["SwiftData", "Attribute", "Unique", "Sentinel", "Debugging"]
image = "thumbnail.png"
+++

SwiftData 마이그 중에 본문 데이터가 한 건만 남고 나머지는 사라지는 버그를 잡고 있었다. API 응답엔 100건이 오는데 DB엔 1건. 더 황당한 건 — 에러가 단 한 줄도 안 뜸.

`try? context.save()`가 모든 걸 삼키고 있었다 ㅋㅋ.

## 코드

```swift
@Model
final class ContentBodyEntity2 {
    @Attribute(.unique) var id: Int
    var remoteItemID: Int
    var body: String

    // 호출처에서 id 안 넘김 → 기본값 .invalidInt
    convenience init(remoteItemID: Int, body: String, id: Int = .invalidInt) {
        self.init()
        self.id = id
        self.remoteItemID = remoteItemID
        self.body = body
    }
}
```

`.invalidInt`는 프로젝트 컨벤션으로 `-1`. "아직 id가 정해지지 않은 스캐폴드 상태"를 의미하는 sentinel. 호출처에서 id 결정하기 전에 임시로 박아두는 패턴이다.

## 무엇이 일어났는가

호출처는 이렇게 만든 entity를 그대로 insert한다.

```swift
let entity = ContentBodyEntity2(
    remoteItemID: snippet.remoteItemID,
    body: snippet.body
)
context.insert(entity)
try? context.save()
```

100건 들어오면 id가 다 `-1`. `@Attribute(.unique)` 제약 때문에:

- 첫 번째 entity: insert 성공 (id=-1로 저장됨)
- 두 번째 entity: id=-1 충돌 → SwiftData가 **insert를 update로 silent하게 변환**
- 세 번째: 또 update로 첫 번째 row를 덮어씀
- ...
- 100번째까지 동일 → 결국 마지막 1건만 살아남음

`try? context.save()`가 throw를 삼키니 로그도 안 남음. 1건만 보일 뿐 화면은 "정상 동작"으로 보임.

조회 단계에서 비로소 증상이 드러난다.

```swift
func read(remoteItemID: Int) -> ContentBodyEntity2? {
    return try? context.fetch(
        FetchDescriptor(predicate: #Predicate { $0.remoteItemID == remoteItemID })
    ).first
}
```

99건은 날아갔으니 대부분의 `read`가 nil. 화면에선 "데이터 없음 → dataNotFound alert" ㅋㅋ.

## 함정의 본질

세 가지 패턴이 겹쳤다.

**1. sentinel default value (`.invalidInt`)**: 코드 가독성 위해 도입했지만, "아직 결정 안 됨"을 표현하려는 의도가 unique 제약이랑 만나면 "모두 같은 값"이 되어버림.

**2. unique 제약의 silent upsert 동작**: SwiftData는 unique 충돌 시 throw 안 하고 silently update로 변환함. 의도된 동작이지만, 그 의도가 "유효한 id가 들어왔다는 전제"에 기댐. sentinel이랑은 호환 안 됨.

**3. try?의 에러 삼킴**: 마지막 안전망인 throw도 `try?` 한 줄에 막힘.

각각 따로 보면 다 합리적인 선택. 합쳐지면 함정이 됨.

## 해결

세 단계로 막을 수 있다.

### 1. Entity 생성 시점에 PK 결정 강제

```swift
@Model
final class ContentBodyEntity2 {
    @Attribute(.unique) var id: Int
    var remoteItemID: Int
    var body: String

    // id를 필수 파라미터로 — 기본값 제거
    init(remoteItemID: Int, body: String) {
        self.id = Self.makeID(remoteItemID: remoteItemID)
        self.remoteItemID = remoteItemID
        self.body = body
    }

    static func makeID(remoteItemID: Int) -> Int {
        // 결정적 hash. 자세한 건 별도 글 참고
        return remoteItemID &* 0x9E3779B97F4A7C15
    }
}
```

기본값 `.invalidInt`를 없애면 컴파일러가 강제함.

### 2. DAO 진입 시점에 안전망

기존 코드가 많아서 일괄 수정 부담스러우면 DAO 레이어에서 한 번 더 막는다.

```swift
enum ContentBodyDAO {
    static func insert(_ data: ContentBodyEntity2) {
        if data.id == .invalidInt {
            data.id = ContentBodyEntity2.makeID(remoteItemID: data.remoteItemID)
        }
        // ... 이후 insert
    }
}
```

### 3. try?를 try로 바꾸고 로그

```swift
do {
    try context.save()
} catch {
    Log.error("ContentBody save failed: \(error)")
    assertionFailure("ContentBody save failed: \(error)")
}
```

`try?`는 "에러가 나도 괜찮은" 진짜 best-effort 경로에만 쓴다. 데이터 저장 같은 핵심 경로에는 절대 X.

## 교훈

`.unique` 제약은 강력하지만 silent upsert 동작이 sentinel 패턴이랑 상극임. 셋 중 하나라도 막으면 함정이 안 생김.

- sentinel 안 쓰기 (PK는 생성 시점에 결정)
- 또는 DAO 진입 시점에 sentinel → 실제 id 변환
- 또는 `try?`를 `try` + 로깅으로 바꿔서 silent 실패 가시화

세 개 다 적용하면 다층 방어가 된다. 마이그 같은 대규모 변경 작업에선 다층 방어가 안전마진이지.
