/**
 * Test setup, run once per test file. Declares a default SDK platform so
 * the `K-SDK` tag resolves in unit tests that exercise the transport layer
 * directly, without booting a platform facade. Production has NO default -
 * each SDK calls `configureSdkPlatform` at init - so this only affects
 * tests. The Node SDK tests override this to `Node` through their own init.
 */
import { configureSdkPlatform } from '@keewano/core';

configureSdkPlatform('ReactNative');
