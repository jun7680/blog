+++
author = "오깅중"
title = "GCD 시리얼 큐로 로그 라이터를 재작성한 이유 — actor + AsyncStream을 버린 결정"
slug = "gcd-serial-queue-over-actor-for-thread-confined"
date = "2026-05-13T15:46:00+09:00"
description = "actor는 mutual exclusion을 보장하지만 thread identity는 보장하지 않는다. Realm/SwiftData 같은 thread-confined 자원에는 GCD serial queue가 답인 이유."
categories = ["Swift"]
tags = ["Swift", "Concurrency", "GCD", "Actor", "Realm", "Debugging"]
image = "thumbnail.png"
+++

크래시 리포트에 이런 시그니처가 떴다.

```
EXC_BREAKPOINT in:
closure #1 in static Log.saveLogData(message:)
└─ swift_allocObject
   └─ _xzm_xzone_malloc_freelist_outlined
```

힙 corruption 패턴. 메모리 할당 단에서 깨지면서 SIGTRAP. 빈도는 낮지만 일관되게 나옴.

스택을 따라 `Log.saveLogData`로 갔다. 호출처를 grep해보니 **306곳**. 모든 곳에서 비동기로 떨어지는 진단 로그가 단일 라이터에 몰리는 구조였다.

## 기존 구조의 세 가지 문제

```swift
static func saveLogData(message: String) {
    Task {  // ① 호출마다 Task 스폰
        await LogDBWriter.shared.save(message)
    }
}

actor LogDBWriter {
    private var isWriting = false

    func save(_ message: String) async {
        guard !isWriting else { return }  // ② 동시 도착 드롭
        isWriting = true

        Task {  // ③ actor 내부 이중 Task 스폰
            await writeAndReset(message)
        }
    }

    private func writeAndReset(_ message: String) async {
        // Realm에 write
        realm.write { ... }
        isWriting = false
    }
}
```

**① 매 호출마다 Task 스폰 (306곳에서)**
디버깅 코드 한 줄에 Task가 하나씩. 트래픽 피크 구간에서 cooperative thread pool에 부하가 누적된다.

**② isWriting 플래그로 동시 도착 로그 드롭**
정작 진단이 필요한 burst 구간에서 로그 대부분이 사라진다. 진단 도구가 진단 가능 구간에서 침묵하는 모순.

**③ actor 내부 이중 Task 스폰**
`save()`가 이미 actor 메서드인데 안에서 또 Task. 호출 1번에 Task 2개. 거기에 Realm `write` 클로저가 또 thread를 점유. 메모리 / lifecycle이 꼬일 환경 다 갖춰짐.

세 개가 합쳐져 cooperative pool 위에서 thread-confined한 Realm engine을 두드리는 구조가 됐다. Realm C++ 엔진은 thread confinement가 빡빡해서 wrong thread access는 즉시 crash. cooperative pool은 hop이 자주 일어나니 충돌 확률이 시간 흐를수록 누적된다.

## 후보 1: actor + AsyncStream

Swift Concurrency를 좋아하는 개발자라면 자연스러운 선택.

```swift
actor LogDBWriter {
    private let stream: AsyncStream<String>
    private let continuation: AsyncStream<String>.Continuation

    init() {
        var cont: AsyncStream<String>.Continuation!
        self.stream = AsyncStream<String>(bufferingPolicy: .bufferingNewest(256)) {
            cont = $0
        }
        self.continuation = cont

        Task { [stream] in
            for await message in stream {
                await write(message)
            }
        }
    }

    nonisolated func enqueue(_ message: String) {
        continuation.yield(message)
    }

    private func write(_ message: String) async {
        realm.write { ... }
    }
}
```

장점:
- Swift Concurrency 정통
- AsyncStream의 buffering policy로 drop 정책 명확
- nonisolated enqueue로 호출처 부담 없음

단점:
- consumer Task가 cooperative pool에서 돈다 — **Realm/SwiftData의 thread confinement와 충돌**
- thread hop이 불특정 시점에 일어남 (런타임 스케줄링에 위임)
- actor가 single concurrent context는 보장하지만 single OS thread는 보장하지 않음

Realm/SwiftData는 ModelContext도 thread-confined다. cooperative pool 위에 올리면 어느 순간 wrong thread access가 일어날 수 있다. crash signature가 정확히 그 패턴이었으니, 같은 패러다임으로 옮기는 건 해결이 아니라 자리 옮기기다.

## 후보 2: GCD 시리얼 큐 + 전용 스레드 (✅ 채택)

```swift
final class LogDBWriter {
    static let shared = LogDBWriter()

    private let queue = DispatchQueue(
        label: "com.app.LogDBWriter",
        qos: .utility
    )
    private var buffer: [String] = []
    private let maxBuffer = 256

    private init() {}

    func enqueue(_ message: String) {
        queue.async { [weak self] in
            guard let self else { return }

            // 가득 차면 가장 오래된 것부터 폐기
            if self.buffer.count >= self.maxBuffer {
                self.buffer.removeFirst()
            }
            self.buffer.append(message)

            self.flushIfNeeded()
        }
    }

    private func flushIfNeeded() {
        guard !buffer.isEmpty else { return }
        let batch = buffer
        buffer.removeAll(keepingCapacity: true)

        realm.write {
            batch.forEach { realm.add(LogEntity(message: $0)) }
        }
    }
}
```

장점:
- **DispatchQueue가 단일 OS 스레드를 보장** (serial queue)
- Realm/SwiftData의 thread confinement와 자연스럽게 호환
- buffer + drop policy가 명시적이고 디버깅 쉬움
- Task 스폰 0개

단점:
- async/await 시대에 GCD를 쓰는 게 "구식"으로 보일 수 있음
- 호출처에서 `await` 못 씀 (애초에 fire-and-forget이라 필요 없지만)

핵심은 **"actor가 단일 concurrent context는 보장하지만 단일 OS 스레드는 보장하지 않는다"**는 사실. Realm은 후자를 요구한다. 그러니 actor가 아니라 serial DispatchQueue가 답이다.

## 일반화: Swift Concurrency가 답이 아닌 경우

Swift Concurrency는 강력하지만 만능이 아니다. 다음 조건이 겹치면 GCD를 고려한다.

- **Thread confinement가 빡빡한 외부 라이브러리** (Realm, SwiftData, SQLite WAL, OpenGL, audio I/O 등)
- **단일 OS 스레드 보장이 필요**한 경우
- **호출처가 async context가 아닌** 동기 영역에서 fire-and-forget로 떨어지는 케이스

이 조건들에서 actor + AsyncStream을 쓰면 cooperative pool 위에서 hop이 일어나고, hop이 thread-confined 자원과 충돌한다. crash signature가 누적된다.

## 교훈

"actor를 쓰면 모든 thread 문제가 해결된다"는 흔한 오해. actor는 **mutual exclusion**을 보장하지만 **thread identity**를 보장하지 않는다.

Realm, SwiftData, ModelContext, 일부 C++ engine은 thread identity까지 요구한다. 그 자원을 다루는 코드는 actor가 아니라 single-threaded executor 위에 올려야 안전하다. GCD serial queue가 단순하면서 정확한 선택이다.

신기술이 좋아 보여서 갈아엎기 전에, 새 도구가 기존 도구가 해결하던 보장을 모두 제공하는지 점검하라. 그게 도구 선택의 첫 단계다.
