+++
author = "오깅중"
title = "Firebase RemoteConfig 빼고 GitHub Actions + 정적 JSON으로 갈아탄 후기"
slug = "firebase-remoteconfig-to-static-json-migration"
date = "2026-05-15T15:40:00+09:00"
description = "단순 broadcast 용도로만 쓰던 Firebase RemoteConfig를 GitHub Actions + 정적 서버 JSON 구조로 갈아탔다. 트레이드오프, 새 구조, 마이그레이션 시 캐시 stale 이슈까지."
categories = ["Swift"]
tags = ["Firebase", "RemoteConfig", "GitHub Actions", "iOS", "Config", "URLSession", "SwiftData"]
+++

iOS 앱에서 버전 강제 업데이트, 공지 팝업, 외부 링크 URL, feature flag 4가지를 Firebase RemoteConfig로 관리하고 있었다. 어느 날 실험실(Lab) 기능 토글을 하나 더 얹어야 했고, 그 김에 RemoteConfig 자체를 걷어내기로 했다. 결과적으로 **정적 서버에 JSON 한 파일을 굽고 `URLSession`으로 GET 하는 구조**가 우리 케이스엔 모든 면에서 나았다.

이 글은 트레이드오프 정리다. RemoteConfig가 나쁘다는 글이 아니라, **언제 빠져야 가벼워지는지**에 관한 글.

## RemoteConfig가 우리한테 과했던 이유

RemoteConfig가 빛나는 케이스는 명확하다.

- A/B 테스트 + 사용자 그룹 타게팅
- 실시간 rollout / instant rollback이 비즈니스 KPI
- Analytics audience와 연동된 조건 분기

우리는 셋 다 안 썼다. iOS 모든 사용자에게 동일 값을 내려주는 단순 broadcast였다. 그 단순 broadcast를 위해 치르고 있던 비용:

- SDK 자체가 무겁다. `FirebaseRemoteConfig` 하나 빼니까 앱 바이너리/시작 시간이 즉시 가벼워진다.
- 캐시 정책이 블랙박스. `setMinimumFetchInterval`만 노출되고, 12시간 default 캐시가 QA 단계에서 디버깅을 어렵게 한다.
- 콘솔 권한 분리가 어렵다. 누구는 Firebase 콘솔 접근 가능, 누구는 불가. PR review도 안 남는다.
- 콘솔 변경이 git 히스토리에 없다. "누가 언제 minVersion을 올렸나"를 추적할 수 없다.
- 안드로이드와 별도 콘솔 관리. 같은 정책을 두 군데서 따로 바꾸면 동기화 어긋난다.

마지막 항목이 결정타였다. iOS / Android 양 플랫폼 공통 정책을 코드 리뷰로 관리하고 싶었다.

## 새 구조

GitHub Actions + 정적 서버(CDN 앞단) 조합으로 갈아탔다.

```
.github/configs/
├── ios-version.json         # version, minVersion, minOS, priority, descriptions
├── ios-labs-config.json     # 실험실 flag
├── ios-external-links.json  # 외부 링크 URL
└── ios-notice-popup.json    # 공지 팝업

→ workflow_dispatch 트리거 →
→ 4개 파일 + 합쳐진 ios-config.json을 rsync로 정적 서버 업로드
→ 클라이언트는 합쳐진 ios-config.json 한 파일만 GET
```

핵심:

- **소스는 JSON 4개로 도메인 분리, 호출은 합쳐서 1회**. 관리는 따로, 트래픽은 하나.
- **수동 트리거(`workflow_dispatch`)**. master 머지 = 즉시 반영이 아니다. App Store 캐시 반영 시점과 RemoteConfig 반영 시점을 맞추려면 사람이 타이밍을 정해야 한다.
- **PR review가 정책 변경의 게이트**. minVersion 한 줄 올리는 것도 PR 거친다.

## 클라이언트 — 그냥 `URLSession` 한 번

```swift
final class AppConfigClient {
    func fetch() async throws -> AppConfigDTO {
        let url = URL(string: ConfigEndpoint.iosConfigJSON)!
        let (data, response) = try await URLSession.shared.data(from: url)

        // raw body + decoded summary 둘 다 info 레벨로 영구 저장
        Log.info("AppConfig response: \(String(data: data, encoding: .utf8) ?? "")")

        let decoded = try JSONDecoder().decode(AppConfigDTO.self, from: data)
        Log.info("AppConfig decoded: version=\(decoded.version)")
        return decoded
    }
}
```

`AppConfigManager`는 기존 `RemoteConfigManager`의 시그니처를 그대로 미러링했다. `loadConfig() → UpdatePriorityType` 같은 호출부가 한 줄도 안 바뀌도록.

```swift
func loadConfig() async -> UpdatePriorityType {
    guard let dto = try? await client.fetch() else { return .notRequired }

    let currentLanguage: LangCode =
        LocaleService.current == .ko ? .ko : .en
    guard let description = dto.descriptions
        .first(where: { $0.langCode == currentLanguage.rawValue }) else {
        return .notRequired
    }

    // minOS / minVersion / current 비교 후 priority 결정
    ...
}
```

호출부가 깨지지 않으면 마이그레이션 PR의 review 부담이 절반으로 떨어진다.

## 캐시 / 인프라

정적 서버 앞단 CDN 캐시는 분 단위. `Cache-Control`을 직접 컨트롤할 수 있다는 게 RemoteConfig 대비 가장 큰 차이.

수동 트리거를 둔 이유 한 번 더:

- master 머지 = 스토어 출시 흐름이지만, 스토어 캐시 반영이 늦으면 강제 업데이트 안내는 떠있는데 새 버전이 스토어에 없는 상황이 생긴다.
- 워크플로우 수동 실행으로 "스토어 캐시 반영 확인 후 배포" 같이 사람이 게이트를 잡는다.

## 데이터 무결성 — 받자마자 정리하기

전환 도중 발견한 사이드 이펙트가 있다. SwiftData에 캐시하던 공지 팝업 entity의 primary key(`target`)가 바뀐 경우, 옛 row가 살아남아 새 데이터를 덮는 회귀가 났다.

```swift
static func insert(data: NoticePopupEntity) {
    let target = data.target

    // 다른 target의 stale entity 정리
    let staleDescriptor = FetchDescriptor<NoticePopupEntity>(
        predicate: #Predicate { $0.target != target }
    )
    (try? ctx.fetch(staleDescriptor))?.forEach { ctx.delete($0) }
    ...
}
```

원격 설정 소스가 바뀌면 클라이언트 캐시 정책도 다시 봐야 한다는 교훈. RemoteConfig가 가려주던 부분이 노출됐다.

## 잃은 것

객관적으로 잃은 기능들도 적어둔다.

- **사용자 세그먼테이션**. 모두에게 동일 값을 내려준다. 점진 rollout 못 한다.
- **실시간 활성화**. 콘솔에서 publish 하면 즉시가 아니다. PR → 머지 → 수동 워크플로우 실행.
- **Analytics 연동 condition**. Firebase audience 기반 분기가 사라진다.

우리는 이 셋이 필요 없었다. 필요한 팀은 RemoteConfig 유지가 옳다.

## 얻은 것

- 앱 바이너리 / 시작 시간 감소 (체감 가능)
- 정책 변경 PR 리뷰 + git 히스토리
- iOS / Android 공통 설정 한 레포에서 관리
- 캐시 정책 직접 컨트롤
- 인증/콘솔 권한 별도 관리 불필요

## 교훈

- RemoteConfig 같은 무거운 SDK를 도입할 때는 "내가 이 SDK의 어떤 기능을 안 쓰는가"를 먼저 정리하라. 안 쓰는 기능이 70% 이상이면 빠지는 게 낫다.
- broadcast-only 원격 설정은 정적 서버 + JSON으로 충분하다. CDN 캐시 정책을 직접 잡을 수 있다는 게 디버깅에 결정적이다.
- 정책 변경을 git/PR 흐름 안에 두면 사고 추적이 무료가 된다. 누가 언제 왜 바꿨는지 자동으로 남는다.
- 마이그레이션 시 기존 호출부 시그니처를 미러링해라. 코드 변경량을 인프라 교체에 집중시킬 수 있다.
- 원격 설정 소스가 바뀌면 클라이언트 캐시 stale 정책도 함께 점검. 안 그러면 옛 데이터가 살아남는다.

### 점검 체크리스트 (RemoteConfig 빼기 전)

- [ ] A/B 테스트 / audience 분기를 실제로 쓰고 있는가?
- [ ] 실시간 rollout / instant rollback이 비즈니스 KPI인가?
- [ ] 콘솔 변경 이력이 추적되어야 하는가? (감사/컴플라이언스)
- [ ] 다른 플랫폼과 공통 정책을 두고 있는가? (iOS/Android)
- [ ] CDN 캐시 정책을 직접 조정해야 할 케이스가 있는가?
