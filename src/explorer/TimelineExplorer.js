// @flow

import React from "react";
import deepEqual from "lodash.isequal";
import * as Weights from "../core/weights";
import {type Weights as WeightsT} from "../core/weights";
import {type NodeAddressT} from "../core/graph";
import {TimelineCred} from "../analysis/timeline/timelineCred";
import {type TimelineCredParameters} from "../analysis/timeline/params";
import {TimelineCredView} from "./TimelineCredView";
import Link from "../webutil/Link";
import {WeightConfig} from "./weights/WeightConfig";
import {WeightsFileManager} from "./weights/WeightsFileManager";
import {
  type PluginDeclarations,
  type PluginDeclaration,
} from "../analysis/pluginDeclaration";
import * as NullUtil from "../util/null";
import {format} from "d3-format";

export type Props = {
  projectId: string,
  initialTimelineCred: TimelineCred,
  pluginDeclarations: PluginDeclarations,
};

export type State = {
  timelineCred: TimelineCred,
  weights: WeightsT,
  alpha: number,
  intervalDecay: number,
  loading: boolean,
  showWeightConfig: boolean,
  selectedNodeTypePrefix: NodeAddressT | null,
};

/**
 * TimelineExplorer allows displaying, exploring, and re-calculating TimelineCred.
 *
 * It basically wraps a TimelineCredView with some additional features and options:
 * - allows changing the weights and re-calculating cred with new weights
 * - allows saving/loading weights
 * - displays the string
 */
export class TimelineExplorer extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const timelineCred = props.initialTimelineCred;
    const {alpha, intervalDecay} = timelineCred.params();
    this.state = {
      timelineCred,
      alpha,
      intervalDecay,
      // Set the weights to a copy, to ensure we don't mutate the weights in the
      // initialTimelineCred. This enables e.g. disabling the analyze button
      // when the parameters are unchanged.
      weights: Weights.copy(timelineCred.weightedGraph().weights),
      loading: false,
      showWeightConfig: false,
      selectedNodeTypePrefix: null,
    };
  }

  params(): TimelineCredParameters {
    const {alpha, intervalDecay} = this.state;
    return {alpha, intervalDecay};
  }

  weights(): WeightsT {
    // Set the weights to a copy, to ensure that the weights we pass into e.g.
    // analyzeCred are a distinct reference from the one we keep in our state.
    return Weights.copy(this.state.weights);
  }

  async analyzeCred() {
    this.setState({loading: true});
    const timelineCred = await this.state.timelineCred.reanalyze(
      this.weights(),
      this.params()
    );
    this.setState({timelineCred, loading: false});
  }

  renderConfigurationRow() {
    const {showWeightConfig} = this.state;
    const weightFileManager = (
      <WeightsFileManager
        weights={this.state.weights}
        onWeightsChange={(weights: WeightsT) => {
          this.setState({weights});
        }}
      />
    );
    const weightConfig = (
      <WeightConfig
        declarations={this.props.pluginDeclarations}
        nodeWeights={this.state.weights.nodeWeights}
        edgeWeights={this.state.weights.edgeWeights}
        onNodeWeightChange={(prefix, weight) => {
          this.setState(({weights}) => {
            weights.nodeWeights.set(prefix, weight);
            return {weights};
          });
        }}
        onEdgeWeightChange={(prefix, weight) => {
          this.setState(({weights}) => {
            weights.edgeWeights.set(prefix, weight);
            return {weights};
          });
        }}
      />
    );

    const alphaSlider = (
      <input
        type="range"
        min={0.05}
        max={0.95}
        step={0.05}
        value={this.state.alpha}
        onChange={(e) => {
          this.setState({alpha: e.target.valueAsNumber});
        }}
      />
    );
    const paramsUpToDate =
      deepEqual(this.params(), this.state.timelineCred.params()) &&
      deepEqual(
        this.weights(),
        this.state.timelineCred.weightedGraph().weights
      );
    const analyzeButton = (
      <button
        disabled={this.state.loading || paramsUpToDate}
        onClick={() => this.analyzeCred()}
      >
        re-compute cred
      </button>
    );
    return (
      <div>
        <div style={{marginTop: 30, display: "flex"}}>
          <span style={{paddingLeft: 30}}>
            cred for {this.props.projectId}
            <Link to={`/prototype/${this.props.projectId}/`}>(legacy)</Link>
          </span>
          <span style={{flexGrow: 1}} />
          {this.renderFilterSelect()}
          <span style={{flexGrow: 1}} />
          <button
            onClick={() => {
              this.setState(({showWeightConfig}) => ({
                showWeightConfig: !showWeightConfig,
              }));
            }}
          >
            {showWeightConfig
              ? "Hide weight configuration"
              : "Show weight configuration"}
          </button>
          {analyzeButton}
        </div>
        {showWeightConfig && (
          <div style={{marginTop: 10}}>
            <span>Upload/Download weights:</span>
            {weightFileManager}
            <span>α</span>
            {alphaSlider}
            <span>{format(".2f")(this.state.alpha)}</span>
            {weightConfig}
          </div>
        )}
      </div>
    );
  }

  renderFilterSelect() {
    const optionGroup = (declaration: PluginDeclaration) => {
      const header = (
        <option
          key={declaration.nodePrefix}
          value={declaration.nodePrefix}
          style={{fontWeight: "bold"}}
        >
          {declaration.name}
        </option>
      );
      const entries = declaration.nodeTypes.map((type) => (
        <option key={type.prefix} value={type.prefix}>
          {"\u2003" + type.name}
        </option>
      ));
      return [header, ...entries];
    };
    return (
      <label>
        <span style={{marginLeft: "5px"}}>Showing: </span>
        <select
          value={NullUtil.orElse(this.state.selectedNodeTypePrefix, "")}
          onChange={(e) => {
            const selectedNodeTypePrefix = e.target.value || null;
            this.setState({selectedNodeTypePrefix});
          }}
        >
          <option key={"All users"} value={""}>
            All users
          </option>
          {this.props.pluginDeclarations.map(optionGroup)}
        </select>
      </label>
    );
  }

  render() {
    const timelineCredView = (
      <TimelineCredView
        timelineCred={this.state.timelineCred}
        selectedNodeFilter={this.state.selectedNodeTypePrefix}
      />
    );
    return (
      <div style={{width: 900, margin: "0 auto"}}>
        {this.renderConfigurationRow()}
        {timelineCredView}
      </div>
    );
  }
}
