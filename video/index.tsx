import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, Audio, Composition, cancelRender, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
// This module also powers the browser preview. Keep the frame path identical.
// @ts-expect-error shared browser module
import {drawScene, getTiming, loadAssets} from '../public/scene.js';

type Source = {image:string; url:string; domain:string; anchor:{x:number;y:number;width:number;height:number}; [key:string]:unknown};
type SearchProps = {word: string; intensity?: number; audioFile?: string; sources?:Source[]};
const SearchBurst: React.FC<SearchProps> = ({word, intensity=.75, audioFile, sources=[]}) => {
  const frame=useCurrentFrame(), {width,height,fps}=useVideoConfig();
  const ref=useRef<HTMLCanvasElement>(null);
  const [handle]=useState(()=>delayRender('Loading real website captures'));
  const [assets,setAssets]=useState<any>(null);
  useEffect(()=>{let alive=true;if(!sources.length){cancelRender(new Error('Prepare actual website sources before exporting.'));return;}loadAssets(staticFile(''),sources).then((result:any)=>{if(alive){setAssets(result);continueRender(handle);}}).catch((error:Error)=>cancelRender(error));return()=>{alive=false;};},[handle,sources]);
  useLayoutEffect(()=>{if(assets&&ref.current)drawScene(ref.current.getContext('2d'),{time:frame/fps,word,width,height,assets,intensity});},[assets,frame,fps,width,height,word,intensity]);
  return <AbsoluteFill style={{backgroundColor:'#18251c'}}><canvas ref={ref} width={width} height={height} style={{width:'100%',height:'100%'}}/>{audioFile?<Audio src={/^https?:/.test(audioFile)?audioFile:staticFile(audioFile)}/>:null}</AbsoluteFill>;
};
const Root:React.FC=()=> <Composition id="SearchBurst" component={SearchBurst} width={1080} height={1920} fps={30} durationInFrames={270} defaultProps={{word:'clarity',intensity:.75}} calculateMetadata={({props})=>({durationInFrames:Math.round(getTiming(props.word).duration*30)})}/>;
registerRoot(Root);
