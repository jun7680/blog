+++
author = "오깅중"
title = "47개 @Model 중 4개만 보존하기 — default-safe 정책 설계"
slug = "swiftdata-default-safe-delete-policy"
date = "2026-05-13T15:44:00+09:00"
description = "47개 @Model 중 4개만 보존하고 43개는 삭제하는 정책을 설계하면서 만난 네 가지 후보. 누락이 안전을 깨지 않는 design 원칙: default = 삭제, 정책 = 한 곳, 적용 = 자동화."
categories = ["Swift"]
tags = ["SwiftData", "Architecture", "DesignPattern", "Migration"]
image = "thumbnail.png"
+++

SwiftData 마이그레이션을 하면서 풀어야 하는 흔한 문제 하나. 로그아웃 시 데이터를 어떻게 정리할 것인가.

- 사용자 도메인 데이터: 다음 로그인 시 새로 받아오면 됨 → 삭제
- 계정 정보: 보존 (캐싱)
- 공지 팝업 본 적 있음 표시: 보존
- 실험실 토글 상태: 보존

총 47개 `@Model` 중 4개만 보존, 43개는 삭제. 이걸 어떻게 표현할 것인가? 코드에 들어가는 한 줄, 한 변수의 위치가 안전성을 바꾸는 케이스다.

## 후보 1: 명시적 삭제 호출 (실패)

처음 떠오르는 방식. 부트스트랩 영역에서 삭제할 모델을 다 적는다.

```swift
func deleteUserScopedData() {
    try? context.delete(model: ItemEntity.self)
    try? context.delete(model: ContactEntity.self)
    try? context.delete(model: CalendarEntity.self)
    // ... 43줄 반복
}
```

문제: **신규 `@Model` 추가 시 누락되면 영구 보존된다**. 새 도메인이 생겼는데 deletion 호출을 까먹으면, 사용자가 로그아웃해도 그 데이터가 안 지워진다. 다른 계정으로 로그인하면 이전 계정 데이터가 보일 수 있다. **누락이 안전을 깬다** → 위험.

## 후보 2: 두 배열로 분리 (실패)

명시적 호출의 변형. 도메인 모델을 "사용자 스코프"와 "보존"으로 둘로 나눈다.

```swift
enum AppSchemaV1 {
    static var userScopedModels: [any PersistentModel.Type] { [/* 43개 */] }
    static var preservedModels: [any PersistentModel.Type] { [/* 4개 */] }
}

func deleteUserScopedData() {
    AppSchemaV1.userScopedModels.forEach { try? context.delete(model: $0) }
}
```

조금 낫지만 **신규 Entity가 두 배열 모두에서 누락될 수 있다**. SwiftData가 model을 인식 못해 런타임 크래시. 게다가 47개 모델 리스트가 두 곳에 나눠져 있어 매번 합집합 = 전체인지 확인해야 한다.

## 후보 3: marker protocol (실패)

도메인 모델 자체에 의도를 박는다.

```swift
protocol PersistentAcrossLogout {}  // marker

@Model
final class AccountEntity: PersistentAcrossLogout { ... }

@Model
final class ItemEntity { ... }  // 이건 채택 안 함
```

장점: 의도가 Entity 정의부에 명확히 드러남.
단점: **Entity마다 conformance 추가가 필요하고, 보존 의사 표현이 47개 파일에 흩어진다**. 정책 변경 시 한눈에 파악이 안 됨. 마이그레이션 같은 대규모 작업에서는 변경 추적이 어렵다.

## 후보 4: 단일 보존 리스트 + 자동 차집합 (✅ 채택)

`AppSchemaV1`에 전체 models 리스트와 보존 리스트만 둔다. 삭제는 두 리스트의 차집합으로 자동 도출.

```swift
enum AppSchemaV1: VersionedSchema {
    static var models: [any PersistentModel.Type] {
        [/* 47개 전체 */]
    }
    static var preservedModels: [any PersistentModel.Type] {
        [AccountEntity.self,
         NoticePopupInformationEntity.self,
         NoticeDescriptionEntity.self,
         LaboratorySettingEntity.self]
    }
}

// 부트스트랩
func deleteUserScopedData() {
    let preservedIds = Set(AppSchemaV1.preservedModels.map { ObjectIdentifier($0) })
    let toDelete = AppSchemaV1.models.filter {
        !preservedIds.contains(ObjectIdentifier($0))
    }
    toDelete.forEach { try? context.delete(model: $0) }
}
```

신규 Entity 추가 시 시나리오를 다시 보자.

- **models 등록 누락**: SwiftData가 인식 못 함 → 즉시 발견 (정의 자체가 안 됨)
- **preservedModels 등록 누락**: default = 삭제 → **안전** (보존 의도였다면 데이터가 사라져서 사용자가 깨닫고 수정. 보존 의도가 아니었다면 그대로 정상)

핵심은 **default 동작이 안전한 쪽**이라는 점이다. "기억 못 하면 보존" 정책은 보안 사고로 번지지만, "기억 못 하면 삭제" 정책은 최악의 경우라도 데이터 복구로 끝난다.

## 일반화: default-safe 설계 원칙

이 패턴은 SwiftData를 떠나서도 적용된다.

- 누락의 비용이 비대칭일 때 — default가 비용이 낮은 쪽으로 가야 한다
- 정책 결정은 **한 곳**에 모아야 한다 — 흩어지면 누락 추적이 어려움
- 정책 적용은 **자동화** — 명시적 호출은 누락 가능성을 만든다

비슷한 사례들:

- HTTP API 응답: 신규 필드 default = `nil` (parsing 실패해도 앱은 살아남음, default = throw였다면 신규 필드 한 줄 추가에 앱 전체 깨짐)
- Feature flag: 신규 flag default = `false` (활성화는 명시적으로, 비활성화는 자동으로)
- Auth scope: 신규 endpoint default = "require auth" (실수로 public이 되는 것보다 안전)

## 교훈

설계의 좋고 나쁨은 "잘 썼을 때"가 아니라 "실수했을 때" 갈린다. 잘 쓰면 4개 후보 다 동작한다. 실수했을 때:

- 후보 1, 2: 보안 사고 또는 런타임 크래시
- 후보 3: 가시성 부족, 변경 추적 어려움
- 후보 4: default = 삭제로 자동 흡수, 최악도 데이터 복구 수준

코드 한 줄을 어디 두느냐가 안전마진을 만든다.
