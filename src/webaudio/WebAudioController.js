/*
 * The copyright in this software module is being made available under the BSD License, included below. This software module may be subject to other third party and/or contributor rights, including patent rights, and no such rights are granted under this license.
 * The whole software resulting from the execution of this software module together with its external dependent software modules from dash.js project may be subject to Orange and/or other third party rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2016, Plain Concepts
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
import Debug from '../core/Debug';
import EventBus from '../core/EventBus';
import Events from '../core/events/Events';
import VideoModel from '../streaming/models/VideoModel';

function WebAudioController(config) {
    let _AudioContext = window.AudioContext || window.webkitAudioContext;
    let context = this.context;
    let eventBus = EventBus(context).getInstance();
    let videoModel = VideoModel(context).getInstance();
    let log = Debug(context).getInstance().log;
    
    let audioContext = null;
    let source = null;
    let analyser = null;
    let jsNode = null;
    let audioProcessorCallback = config.audioProcessorCallback;

    function setup() {
        log('[WebAudioController] -> Initializing webaudio.')
        audioContext = new _AudioContext();
        let mediaElement =  videoModel.getElement();
        source = audioContext.createMediaElementSource(mediaElement);
        // setup a javascript node
        jsNode = audioContext.createScriptProcessor(2048, 1, 1);
        jsNode.onaudioprocess = onaudioprocess;
        // connect to destination, else it isn't called
        jsNode.connect(audioContext.destination);
 
        // setup a analyzer
        analyser = audioContext.createAnalyser();
        analyser.smoothingTimeConstant = 0.3;
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyser.connect(jsNode);
        // Connect to sound output to hear sound :D
        source.connect(audioContext.destination);
    }

    function setAudioProcessorCallback(callback) {
        audioProcessorCallback = callback;
    }


    function onaudioprocess() {
         var array =  new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        var average = getAverageVolume(array);

        if (audioProcessorCallback) {
            audioProcessorCallback({volume: average});
        }
    }

    function getAverageVolume(array) {
        var values = 0;
        var average;
        var length = array.length; 
        for (var i = 0; i < length; i++) {
            values += array[i];
        }
        average = values / length;
        return average;
    }

    
    let instance = {
        setAudioProcessorCallback: setAudioProcessorCallback
    };
    
    setup();
    
    return instance;
}

WebAudioController.__dashjs_factory_name = 'WebAudioController';
export default FactoryMaker.getClassFactory(WebAudioController);