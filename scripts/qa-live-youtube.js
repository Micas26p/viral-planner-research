'use strict';

process.env.VPR_QA_DEV = '1';
process.env.VPR_QA_LIVE_VIEWER = '1';
process.env.VPR_QA_REAL_TRAIL = '1';
require('./qa-desktop-smoke');
