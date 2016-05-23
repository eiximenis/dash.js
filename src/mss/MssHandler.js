/*
 * The copyright in this software module is being made available under the BSD License, included below. This software module may be subject to other third party and/or contributor rights, including patent rights, and no such rights are granted under this license.
 * The whole software resulting from the execution of this software module together with its external dependent software modules from dash.js project may be subject to Orange and/or other third party rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2014, Orange
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * •  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * •  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * •  Neither the name of the Orange nor the names of its contributors may be used to endorse or promote products derived from this software module without specific prior written permission.
 *
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS” AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import FactoryMaker from '../core/FactoryMaker.js';
import Events from '../core/events/Events';
import EventBus from '../core/EventBus';
import SegmentsGetter from '../dash/utils/SegmentsGetter';
import FragmentRequest from '../streaming/vo/FragmentRequest.js';

function MssHandler(config) {
    "use strict";
    debugger;
    
    let context = this.context;
    let streamProcessor, requestedTime, segmentsGetter, isDynamic, index
    let eventBus = EventBus(context).getInstance();
    let segmentBaseLoader = config.segmentBaseLoader;
    let timelineConverter = config.timeLineConverter;

    
    var getAudioChannels = function(adaptation, representation) {
        debugger;
            var channels = 1;

            if (adaptation.audioChannels) {
                channels = adaptation.audioChannels;
            } else if (representation.audioChannels) {
                channels = representation.audioChannels;
            }

            return channels;
        },

        getAudioSamplingRate = function(adaptation, representation) {
            debugger;
            var samplingRate = 1;

            if (adaptation.audioSamplingRate) {
                samplingRate = adaptation.audioSamplingRate;
            } else {
                samplingRate = representation.audioSamplingRate;
            }

            return samplingRate;
        },

        // Generates initialization segment data from representation information
        // by using mp4lib library
        getInitData = function(representation) {
            debugger;
            var manifest = rslt.manifestModel.getValue(),
                adaptation,
                realAdaptation,
                realRepresentation,
                track,
                codec;

            if (representation.initData) {
                return representation.initData;
            }

            // Get required media information from manifest  to generate initialisation segment
            adaptation = representation.adaptation;
            realAdaptation = manifest.Period_asArray[adaptation.period.index].AdaptationSet_asArray[adaptation.index];
            realRepresentation = realAdaptation.Representation_asArray[representation.index];

            track = new MediaPlayer.vo.Mp4Track();
            track.type = rslt.getType() || 'und';
            track.trackId = adaptation.index + 1; // +1 since track_id shall start from '1'
            track.timescale = representation.timescale;
            track.duration = representation.adaptation.period.duration;
            track.codecs = realRepresentation.codecs;
            track.codecPrivateData = realRepresentation.codecPrivateData;
            track.bandwidth = realRepresentation.bandwidth;

            if (track.type !== 'text') {
                codec = realRepresentation.mimeType + ';codecs="' + realRepresentation.codecs + '"';
                if (!this.capabilities.supportsCodec(this.videoModel.getElement(), codec)) {
                    throw {
                        name: MediaPlayer.dependencies.ErrorHandler.prototype.MEDIA_ERR_CODEC_UNSUPPORTED,
                        message: "Codec is not supported",
                        data: {
                            codec: codec
                        }
                    };
                }
            }

            // DRM Protected Adaptation is detected
            if (realAdaptation.ContentProtection_asArray && (realAdaptation.ContentProtection_asArray.length > 0)) {
                track.contentProtection = realAdaptation.ContentProtection_asArray;
            }

            // Video related informations
            track.width = realRepresentation.width || realAdaptation.maxWidth;
            track.height = realRepresentation.height || realAdaptation.maxHeight;

            // Audio related informations
            track.language = realAdaptation.lang ? realAdaptation.lang : 'und';

            track.channels = getAudioChannels(realAdaptation, realRepresentation);
            track.samplingRate = getAudioSamplingRate(realAdaptation, realRepresentation);

            representation.initData = rslt.mp4Processor.generateInitSegment([track]);
            
            return representation.initData;

        };
    
    //CCE: Modified!!
    //var rslt = MediaPlayer.utils.copyMethods(Dash.dependencies.DashHandler);
    var rslt = {};
    rslt.mp4Processor = undefined;
    
    //CCE:Added!
    rslt.initialize = function (StreamProcessor) {
        //CCE: Comments!
        streamProcessor = StreamProcessor;
        // type = streamProcessor.getType();
        isDynamic = streamProcessor.isDynamic();
        debugger;
        segmentsGetter = SegmentsGetter(context).create(config, isDynamic);
    }
    
    //CCE:Added!
    function updateSegmentList(representation) {

        if (!representation) {
            throw new Error('no representation');
        }

        representation.segments = null;

        updateSegments(representation);

        return representation;
    }
    
    //CCE:Added!
    function onSegmentListUpdated(representation, segments) {

        representation.segments = segments;

        if (segments && segments.length > 0) {
            earliestTime = isNaN(earliestTime) ? segments[0].presentationStartTime : Math.min(segments[0].presentationStartTime,  earliestTime);
        }

        if (isDynamic && isNaN(timelineConverter.getExpectedLiveEdge())) {
            let lastIdx = segments.length - 1;
            let lastSegment = segments[lastIdx];
            let liveEdge = lastSegment.presentationStartTime;
            let metrics = metricsModel.getMetricsFor('stream');
            // the last segment is supposed to be a live edge
            timelineConverter.setExpectedLiveEdge(liveEdge);
            metricsModel.updateManifestUpdateInfo(dashMetrics.getCurrentManifestUpdate(metrics), {presentationStartTime: liveEdge});
        }
    }
    
    //CCE:Added!
    function updateSegments(representation) {
        return segmentsGetter.getSegments(representation, requestedTime, index, onSegmentListUpdated);
    }
    
    rslt.updateRepresentation = function(representation, keepIdx) {
        var hasInitialization = representation.initialization;
        var hasSegments = representation.segmentInfoType !== 'BaseURL' && representation.segmentInfoType !== 'SegmentBase';
        var error;
        
        //CCE: Modified!
        if (hasInitialization == null)
            hasInitialization = true;
        
        if (!representation.segmentDuration && !representation.segments) {
            updateSegmentList(representation);
        }

        representation.segmentAvailabilityRange = null;
        representation.segmentAvailabilityRange = timelineConverter.calcSegmentAvailabilityRange(representation, isDynamic);

        if ((representation.segmentAvailabilityRange.end < representation.segmentAvailabilityRange.start) && !representation.useCalculatedLiveEdgeTime) {
            error = new Error(SEGMENTS_UNAVAILABLE_ERROR_CODE, 'no segments are available yet', {availabilityDelay: representation.segmentAvailabilityRange.start - representation.segmentAvailabilityRange.end});
            eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation, error: error});
            return;
        }

        if (!keepIdx) index = -1;
        
        debugger;
        if (representation.segmentDuration) {
            updateSegmentList(representation);
        }
        
        debugger;
        if (!hasInitialization) {
           segmentBaseLoader.loadInitialization(representation);
        }
        //hasInitialization = false;
        
        if (!hasSegments) {
            segmentBaseLoader.loadSegments(representation, type, representation.indexRange);
        }

        if (hasInitialization && hasSegments) {
            eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});
        }
        eventBus.trigger(Events.REPRESENTATION_UPDATED, {sender: this, representation: representation});
    };

    rslt.getInitRequest = function(representation) {
        debugger;
        var period = null,
            self = this,
            presentationStartTime = null,
            request = null,
            deferred = Q.defer();

        if (!representation) {
            throw new Error("MssHandler.getInitRequest(): representation is undefined");
        }

        period = representation.adaptation.period;
        presentationStartTime = period.start;
        
        //CCE: Modified!
        request = new FragmentRequest();
        //request = new MediaPlayer.vo.SegmentRequest();
        
        //CCE: Modified!
        //request.streamType = rslt.getType();
        request.streamType = representation.adaptation.type;
        request.type = "Initialization Segment";
        request.url = null;
        
        //CCE: Comment!
        // try {
        //     request.data = getInitData.call(this, representation);
        // } catch (e) {
        //     deferred.reject(e);
        //     return deferred.promise;
        // }

        request.range = representation.range;
        
        
        //CCE: Comment! WTF
        // request.availabilityStartTime = self.timelineConverter.calcAvailabilityStartTimeFromPresentationTime(presentationStartTime, representation.adaptation.period.mpd, rslt.getIsDynamic());
        // request.availabilityEndTime = self.timelineConverter.calcAvailabilityEndTimeFromPresentationTime(presentationStartTime + period.duration, period.mpd, rslt.getIsDynamic());

        //request.action = "complete"; //needed to avoid to execute request
        request.quality = representation.index;
        deferred.resolve(request);

        return deferred.promise;
    };

    rslt.getIFrameRequest = function(request){
        debugger;
        if (request && request.url && (request.streamType === "video" || request.streamType === "audio")) {
            request.url = request.url.replace('Fragments','KeyFrames');
        }

        return request;
    };

    return rslt;
};

MssHandler.__dashjs_factory_name = 'MssHandler';
export default FactoryMaker.getClassFactory(MssHandler);