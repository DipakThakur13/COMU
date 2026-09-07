# @comu/model-core

Provider-neutral model gateway and protocol adapter for COMU.

## Overview

`@comu/model-core` provides an extensible, BYOK abstraction layer for connecting to any frontier AI model or local inference server.

## Features

- **OpenAI-Compatible Gateway**: Uniform adapter for any API speaking the OpenAI completions/chat completions standard.
- **GPT-6 Astra Compatibility**: Full support for Experiential Labs' GPT-6 Astra gateway with up to 1,050,000 token context window.
- **Provider Registry (`ModelRequestManager`)**: Centralized dispatch, rate limiting, request tracking, and retry logic.
- **BYOK Security**: Clean separation between credentials (held securely by client) and model gateway logic.

## License

MIT © Dipak Kumar (Boswas Group)
