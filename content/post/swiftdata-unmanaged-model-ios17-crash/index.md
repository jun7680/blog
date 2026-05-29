+++
author = "오깅중"
title = "iOS 17에서만 죽는 SwiftData 크래시 — unmanaged @Model의 함정"
slug = "swiftdata-unmanaged-model-ios17-crash"
date = "2026-05-29T14:20:00+09:00"
description = "ModelContext 밖에서 init한 @Model의 합성 getter가 iOS 17 런타임에서 SIGABRT — 운반은 순수 struct로 바꿨다."
categories = ["Swift"]
tags = ["SwiftData", "Swift", "iOS17", "Crash", "Debugging", "ModelContext", "Macro"]
image = ""
+++

배포된 앱이 특정 화면 진입에서 죽는다는 제보가 들어왔다. 그런데 조건이 이상했다. iOS 18 기기는 멀쩡한데 **iOS 17에서만** 죽는다. 같은 빌드, 같은 코드인데 OS만 타는 크래시였다. 비슷한 증상으로 헤매는 사람이 있을 것 같아 원인 찾던 과정을 남겨둔다.

## 증상

크래시 로그에 찍힌 건 이거였다.

```
Can't show source file for stack frame 3: ProfileEntity.updated.getter
The file path does not exist on the file system:
.../swift-generated-sources/@__swiftmacro_..._PersistedPropertyfMa_.swift
```

처음엔 이 메시지에 낚인다. "소스 파일이 없다"는 문구 때문에 빌드 설정이나 DerivedData 문제로 의심하게 된다. 근데 아니다. 이건 디버거가 **매크로가 합성한 코드**의 소스를 보여줄 수 없다는 안내일 뿐이다. `@__swiftmacro_..._PersistedProperty...`는 SwiftData `@Model` 매크로가 프로퍼티마다 만들어내는 접근자다. 진짜 크래시 지점은 `updated` 프로퍼티의 getter, 즉 `@Model`이 합성한 접근자 안이었다.

## @Model을 DTO처럼 쓰던 코드

문제의 DAO는 사연이 있었다. SwiftData로 마이그레이션하던 중 구 스키마 레코드에서 SIGABRT가 나서, **SwiftData I/O를 통째로 우회**하고 UserDefaults에 JSON 스냅샷으로만 저장·조회하도록 임시 처리가 들어가 있었다.

그런데 데이터를 주고받는 **운반체로는 여전히 `@Model` 클래스 인스턴스**를 쓰고 있었다.

```swift
// 네트워크 응답을 @Model 인스턴스로 만들어 DAO에 넘김
DAO.upsert(data: ProfileEntity(dto: response))

// DAO 내부: 넘어온 @Model의 getter를 줄줄이 읽어 스냅샷 생성
func saveSnapshot(_ data: ProfileEntity) {
    let snapshot = Snapshot(id: data.id, updated: data.updated, ...) // 여기서 터진다
}
```

`ProfileEntity(dto:)`로 만든 인스턴스는 **ModelContext에 한 번도 insert된 적 없는 객체**다. 이른바 unmanaged 상태. SwiftData store에는 발도 들이지 않은 객체다. 그런데도 `@Model`이 합성한 getter는 backing data 레이어를 경유하도록 만들어져 있고, iOS 17 런타임은 이 unmanaged 상태에서의 접근을 제대로 처리하지 못하고 SIGABRT를 낸다.

iOS 18에서 안 죽은 이유는 단순하다. 런타임이 개선됐다. 같은 코드, 다른 결과.

## 해결 — 운반은 순수 struct로

고친 방향은 명확했다. **DAO가 `@Model` 인스턴스를 만들지 않게 한다.** 데이터를 옮길 때는 동일한 필드를 가진 순수 struct를 쓴다.

```swift
struct Profile: Codable {
    var id: Int
    var updated: String?
    // ... 직렬화하던 필드 그대로
}
```

`@Model` 타입 정의와 스키마 등록(`models` 배열)은 **건드리지 않았다**. 지우는 순간 ModelContainer 초기화와 로그아웃 시 삭제 로직이 깨지고, 마이그레이션 스테이지가 비어 있으면 기존 사용자의 store 스키마 인식이 어긋난다. 크래시만 잡으면 되는 핫픽스에서 스키마까지 흔들 이유가 없었다.

한 가지 더. 새 struct의 **필드명과 타입을 기존 직렬화 포맷과 정확히 일치**시켰다. 저장 키도 그대로 뒀다. JSON 키는 결국 프로퍼티 이름이라, 이름 하나만 바뀌어도 기존 사용자가 저장해둔 데이터가 조용히 디코딩 실패한다. 무음 데이터 손실은 크래시보다 무섭다.

## 교훈

`@Model`은 그냥 데이터 클래스가 아니다. **ModelContext 생명주기에 묶인 객체**다. ModelContext 밖에서 init해서 DTO처럼 들고 다니면, 그 프로퍼티 접근은 합성 접근자를 타고 backing data로 내려간다. 최소 지원 OS의 런타임이 이걸 받쳐주지 못하면 그대로 터진다.

점검할 거 몇 가지만 적어둔다.

- `@Model` 인스턴스를 `ModelContext` 없이 `init`해서 프로퍼티를 읽는 코드가 있는가
- SwiftData를 우회하면서 운반체로만 `@Model`을 쓰는 DAO가 있는가 → 순수 struct로 교체
- 직렬화 타입을 바꿀 때 필드명·저장 키를 보존했는가 (디코딩 호환)
- 크래시가 OS 버전을 타면, 코드 분기가 아니라 **프레임워크 런타임 차이**부터 의심

디버거가 `@__swiftmacro_...` 소스를 못 찾는다고 할 때, 그건 빌드 문제가 아니라 **매크로 합성 접근자에서 터졌다는 신호**다. 그 줄을 읽고 방향을 바꾸면 시간을 아낀다.
